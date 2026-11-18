import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { readChildArticles } from './child-layouts.mjs';
import { readSuperarticlePlan, superarticleLayout } from './reference-layout.mjs';

export function missingGlossaryTerms(blocks, terms) {
  const normalize = value => value.normalize('NFC').toLocaleLowerCase('ru-RU').trim().replace(/\s+/gu, ' ');
  const lines = blocks.map(normalize);
  const letter = /[\p{L}\p{N}\p{M}]/u;
  return terms.filter(term => {
    const phrase = normalize(term);
    return !phrase || !lines.some(line => {
      for (let index = line.indexOf(phrase); index !== -1; index = line.indexOf(phrase, index + 1)) {
        if (!letter.test(line[index - 1] ?? '') && !letter.test(line[index + phrase.length] ?? '')) return true;
      }
      return false;
    });
  });
}

export async function readSpaceContent(filename, space, { requireRoundedAssets = false } = {}) {
  const { superarticle, children } = JSON.parse(await readFile(filename, 'utf8'));
  const keys = ['SUPER', 'SUPER-1', 'SUPER-2', 'SUPER-3'];
  const pages = keys.map(key => space.pages.find(page => page.key === key));
  if (!space.structureOnly || pages.some((page, index) => !page || page.kind === 'database' ||
    page.parent !== (index ? 'SUPER' : 'ROOT'))) {
    throw new Error('Для наполнения нужны SUPER и три вложенные статьи SUPER-1…3.');
  }
  if (!superarticle || !Array.isArray(children) || children.length !== 3 ||
      new Set(children.map(page => page.key)).size !== 3 || children.some(page => !keys.slice(1).includes(page.key))) {
    throw new Error('В плане наполнения укажите superarticle и три children с ключами SUPER-1…3.');
  }
  // До создания у статей ещё нет URL. Подстановочные адреса нужны только для проверки входного плана.
  const placeholder = index => space.host + '/at/00000000-0000-0000-0000-00000000000' + index;
  const primary = await readSuperarticlePlan(filename, { ...superarticle, target: placeholder(0),
    ...(requireRoundedAssets && { assets: { ...superarticle.assets, presentation: 'full-width-faq' } }),
    title: pages[0].title, children: keys.slice(1).map((_, index) => placeholder(index + 1)) });
  const nested = await readChildArticles(filename, { parent: placeholder(0), parentTitle: pages[0].title,
    pages: pages.slice(1).map((page, index) => ({
      ...children.find(child => child.key === page.key), target: placeholder(index + 1), title: page.title,
    })),
  });
  const preparation = nested.pages.find(page => page.layout === 'preparation');
  const finish = nested.pages.find(page => page.layout === 'finish');
  const program = nested.pages.find(page => page.layout === 'program');
  const headings = [...primary.headings, program.checkpointsTitle, program.checklistTitle, preparation.beforeTitle, preparation.actionsTitle,
    finish.mermaidTitle];
  const formats = preparation.documents.map(file => extname(file).toLowerCase()).sort().join(',');
  if (primary.assets?.images.length !== 2 || formats !== '.docx,.pdf,.pptx,.xlsx' || !preparation.googleSheet ||
      !finish.mermaid || finish.diagrams.length !== 2 ||
      !headings.every(heading => /^\p{Extended_Pictographic}/u.test(heading ?? ''))) {
    throw new Error('Нужны две иллюстрации, четыре вложения, опубликованная таблица, Mermaid, две draw.io и эмодзи в заголовках.');
  }
  const glossaryTerms = space.glossary.map(({ term }) => term);
  const paragraphs = [];
  function collect(node) {
    if (node.content?.every(child => child.type === 'text')) {
      paragraphs.push(node.content.map(child => child.text).join(''));
      return;
    }
    node.content?.forEach(collect);
  }
  collect(superarticleLayout(primary).doc);
  const missing = missingGlossaryTerms(paragraphs, glossaryTerms);
  if (missing.length) throw new Error('Добавьте в текст суперстатьи термины глоссария: ' + missing.join(', ') + '.');
  return { primary, nested, glossaryTerms };
}

export function spaceContentHandlers(current, prepared, mainRunner, childRunner, mainLayout, childLayout, findMissingTerms) {
  function bind(state) {
    const url = key => state.objects[key].url;
    return {
      main: { ...prepared.primary, target: url('SUPER'),
        children: ['SUPER-1', 'SUPER-2', 'SUPER-3'].map(url) },
      children: { ...prepared.nested, parent: url('SUPER'),
        pages: prepared.nested.pages.map(page => ({ ...page, target: url(page.key) })) },
    };
  }

  return {
    async fill(state, save) {
      const { main, children } = bind(state);
      state.content ??= {};
      const targets = [{ key: 'SUPER', target: main.target }, ...children.pages];
      const pending = targets.filter(({ key }) => !state.content[key]?.written);
      const existingTabs = new Set(current.context().pages());
      const results = await Promise.all(pending.map(async ({ key, target }) => {
        const started = Date.now();
        try {
          const options = { target, reloadAfterSave: false, checkCards: false };
          const result = key === 'SUPER' ? await mainRunner(current, main, 'apply', mainLayout, options) :
            (await childRunner(current, children, 'apply', childLayout, options)).pages[0];
          return { key, ...result, elapsedMs: Date.now() - started };
        } catch (error) {
          return { key, error: error.message.split('\n')[0], elapsedMs: Date.now() - started };
        }
      }));
      for (const { key, ...result } of results) {
        state.content[key] = { ...result, written: !result.error, verified: false };
      }
      await save();
      const writtenUrls = new Set(results.filter(result => !result.error).map(result => result.url));
      await Promise.allSettled(current.context().pages()
        .filter(tab => !existingTabs.has(tab) && writtenUrls.has(tab.url())).map(tab => tab.close()));
      const failed = results.filter(result => result.error);
      if (failed.length) throw new Error(failed.map(({ key, error }) => key + ' — ' + error).join(' | '));
      return Object.fromEntries(results.map(({ key, elapsedMs, diagramsMs }) => [key, { elapsedMs, diagramsMs }]));
    },
    async verify(page, item, state) {
      const { main, children } = bind(state);
      const options = { target: state.objects[item.key].url, useCurrent: true, checkMedia: true };
      const result = item.key === 'SUPER' ? await mainRunner(page, main, 'verify', mainLayout, options) :
        (await childRunner(page, children, 'verify', childLayout, options)).pages[0];
      if (result.error) throw new Error(result.error);
      if (item.key === 'SUPER') {
        const blocks = await page.locator('.editor__editor > .tiptap.ProseMirror').evaluate(element => {
          const doc = element.editor.state.doc;
          return doc.textBetween(0, doc.content.size, '\n').split('\n');
        });
        const missing = findMissingTerms(blocks, prepared.glossaryTerms);
        if (missing.length) throw new Error('В сохранённой суперстатье отсутствуют термины: ' + missing.join(', ') + '.');
        result.glossaryTerms = prepared.glossaryTerms;
      }
      state.content[item.key].verified = true;
      state.content[item.key].verification = result;
    },
  };
}
