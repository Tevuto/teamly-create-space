import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

export async function readChildArticles(filename, plan = undefined) {
  plan ??= JSON.parse(await readFile(filename, 'utf8'));
  const parent = new URL(plan.parent);
  const article = url => url.origin === parent.origin && url.protocol === 'https:' &&
    /^\/at\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(url.pathname) && !url.search && !url.hash;
  const nonempty = value => typeof value === 'string' && Boolean(value.trim());
  const strings = (value, length) => Array.isArray(value) && value.length === length && value.every(nonempty);
  const materials = value => Array.isArray(value) && (value.length === 0 || strings(value, 4));
  if (!article(parent) || !nonempty(plan.parentTitle) || !Array.isArray(plan.pages) || plan.pages.length !== 3 ||
      new Set(plan.pages.map(item => item.target)).size !== 3 ||
      !['program', 'preparation', 'finish'].every(name => plan.pages.some(item => item.layout === name))) {
    throw new Error('Укажите родителя и три разные статьи с макетами program, preparation и finish.');
  }
  const local = file => resolve(dirname(filename), file);
  for (const item of plan.pages) {
    if (!article(new URL(item.target)) || item.target === plan.parent || !nonempty(item.title) || !nonempty(item.intro)) {
      throw new Error('Неверный адрес или заголовок вложенной статьи.');
    }
    if (item.layout === 'program' && (!Array.isArray(item.table) || !item.table.every(row => strings(row, 3)) ||
        item.table.length < 2 || !strings(item.checklist, 4) || !nonempty(item.callout))) throw new Error('Заполните программу и контрольные точки.');
    if (item.layout === 'preparation') {
      if (!materials(item.documents) || !materials(item.images) || !strings(item.before, 3) || !strings(item.actions, 3) ||
          ![item.filled, item.ready].every(nonempty)) throw new Error('Заполните подготовку. Каждая группа материалов содержит четыре файла или остаётся пустой.');
      item.files = [...item.documents, ...item.images].map(path => ({ path: local(path), name: basename(path).normalize() }));
      if (new Set(item.files.map(file => file.name)).size !== item.files.length) throw new Error('Названия материалов должны быть различны.');
      for (const file of item.files) if (!(await stat(file.path)).isFile()) throw new Error('Нет материала «' + file.name + '».');
      if (item.googleSheet !== undefined) {
        const sheet = new URL(item.googleSheet);
        if (sheet.origin !== 'https://docs.google.com' ||
            !/^\/spreadsheets\/d\/e\/[\w-]+\/pubhtml$/u.test(sheet.pathname)) {
          throw new Error('Для виджета нужна ссылка на опубликованную Google Таблицу.');
        }
      }
    }
    if (item.layout === 'finish') {
      if (item.mermaidFile !== undefined) {
        if (!nonempty(item.mermaidFile) || !/\.mmd$/iu.test(item.mermaidFile) || item.mermaid !== undefined) {
          throw new Error('Передайте один источник Mermaid: путь к готовому .mmd или содержимое диаграммы.');
        }
        item.mermaid = (await readFile(local(item.mermaidFile), 'utf8')).trim();
        item.mermaidTitle ??= '🔀 ' + basename(item.mermaidFile, '.mmd');
      }
      if (!strings(item.tabs, 3) || new Set(item.tabs).size !== 3 || !strings(item.outcome, 3) ||
          ![item.help, item.process].every(nonempty) || (item.mermaid !== undefined && !nonempty(item.mermaid)) ||
          (item.mermaidTitle !== undefined && (!nonempty(item.mermaid) || !nonempty(item.mermaidTitle))) ||
          !Array.isArray(item.diagrams) || ![0, 2].includes(item.diagrams.length)) {
        throw new Error('Заполните три вкладки. Блок Draw.io использует две диаграммы или пропускается.');
      }
      item.diagrams = await Promise.all(item.diagrams.map(async ({ file, label, title }) => {
        const source = await readFile(local(file), 'utf8');
        const xml = source.match(/<mxGraphModel\b[\s\S]*?<\/mxGraphModel>/u)?.[0];
        if (!nonempty(label) || !xml?.includes(label)) throw new Error('Проверьте исходник диаграммы: ' + file);
        return { label, xml, title };
      }));
    }
  }
  return plan;
}

export function childArticleLayout(item, plan, widgets = {}) {
  const block = (type, content = [], attrs = {}) => ({ type, attrs: { id: crypto.randomUUID(), ...attrs }, ...(content.length && { content }) });
  const text = (value, marks) => ({ type: 'text', text: value, ...(marks && { marks }) });
  const p = (value, marks) => block('paragraph', value ? [text(value, marks)] : []);
  const h = value => block('heading', [text(value)], { level: 2 });
  const panel = (type, value, attrs) => block('panel', [p(value)], { type, ...attrs });
  const list = (items, checks = false) => block(checks ? 'todo_list' : 'bullet_list', items.map(value =>
    block(checks ? 'todo_item' : 'list_item', [p(value)], checks ? { checked: false, done: false } : {})));
  const links = layouts => block('panel', layouts.map(layout => {
    const target = layout === 'main' ? { title: plan.parentTitle, target: plan.parent } :
      plan.pages.find(page => page.layout === layout);
    return p(target.title, [{ type: 'link', attrs: { link: { url: target.target, type: 'external' } } }]);
  }), { type: 'note', emoji: '🔗' });
  const table = rows => block('table', rows.map((row, y) => block('table_row', row.map((value, x) =>
    block('table_cell', [p(value, y ? undefined : [{ type: 'bold' }])], {
      colspan: 1, rowspan: 1, colwidth: [[230, 470, 175][x]], color: y % 2 ? 'tropical-blue' : 'perano',
    })))), { mode: 'base', visibility: 'visible', labels: [] });
  const result = content => ({ type: 'doc', content });
  if (item.layout === 'program') return result([
    panel('info', item.intro), h(item.checkpointsTitle ?? 'Контрольные точки'), table(item.table), block('horizontal_rule'),
    h(item.checklistTitle ?? 'Чек-лист сверки отчёта'), list(item.checklist, true), panel('warning', item.callout), links(['preparation', 'finish']),
  ]);
  if (item.layout === 'preparation') {
    const media = name => widgets.media?.[name] ?? block('mediaWrapper', [{ type: 'media', attrs: { _meta: { title: name } } }]);
    const columns = files => block('columns', files.map(({ name }) => block('column', [media(name)], { basis: 25 })));
    return result([
      panel('note', item.intro, { customBg: 'concrete' }), h(item.beforeTitle ?? 'Материалы к первому дню'), list(item.before), p(),
      ...(item.documents.length ? [
        ...(item.documentsNote ? [p(item.documentsNote)] : []),
        columns(item.files.slice(0, item.documents.length)),
      ] : []), block('horizontal_rule'),
      ...(item.images.length ? [columns(item.files.slice(item.documents.length))] : []),
      h(item.actionsTitle ?? 'Что сделать до выхода'), list(item.actions), p(item.filled), p(), p(item.ready),
      ...(item.googleSheet ? [h('📊 Пример опубликованной таблицы'),
        block('remote_docs', [], { src: item.googleSheet, height: 600, main: true })] : []),
      links(['main', 'program', 'finish']), p(),
    ]);
  }
  const tab = (index, content) => block('tabContent', content, {
    ...widgets.tabs?.content[index]?.attrs, title: item.tabs[index], emoji: (item.tabEmoji ?? ['1️⃣', '2️⃣', '3️⃣'])[index],
  });
  const diagram = index => item.diagrams[index] ? [
    ...(item.diagrams[index].title ? [h(item.diagrams[index].title)] : []),
    widgets.diagrams?.[index] ?? block('drawioDiagram', [], { height: '380' }),
  ] : [];
  const mermaid = item.mermaid ? [
    ...(item.mermaidTitle ? [h(item.mermaidTitle)] : []),
    block('codeBlock', [block('codeEditor', [text(item.mermaid)], { language: 'javascript' })],
    { language: 'mermaid', viewMode: 'content' })] : [];
  return result([block('tabs', [
    tab(0, [panel('info', item.intro), ...mermaid, panel('ready', item.help), ...diagram(0), p()]),
    tab(1, [p(item.process), ...diagram(1), p()]),
    tab(2, [list(item.outcome), links(['program', 'main']), p()]),
  ], widgets.tabs?.attrs)]);
}

export async function runChildArticles(current, plan, mode, compile, {
  target, useCurrent = false, reloadAfterSave = true, checkMedia = false,
} = {}) {
  const timeout = { timeout: 12000 };
  const selector = '.editor__editor > .tiptap.ProseMirror';
  const parentPath = new URL(plan.parent).pathname;
  function signature(node) {
    const attrs = node.attrs;
    return [node.type, node.text, attrs?.title, attrs?._meta?.title?.normalize(), attrs?.language,
      node.type === 'remote_docs' ? attrs?.src : undefined,
      node.marks?.filter(mark => mark.type === 'link').map(mark => mark.attrs.link.url), node.content?.map(signature)];
  }
  function collect(doc) {
    const staged = new Map();
    const diagrams = [];
    const visit = node => {
      const media = node.type === 'mediaWrapper' && node.content?.[0];
      if (media?.attrs?._uploaded && media.attrs._meta?.title) staged.set(media.attrs._meta.title.normalize(), node);
      if (node.type === 'drawioDiagram') diagrams.push(node);
      node.content?.forEach(visit);
    };
    visit(doc);
    return { media: Object.fromEntries(staged), diagrams, tabs: doc.content[0]?.type === 'tabs' ? doc.content[0] : undefined };
  }

  async function selectTab(page, title) {
    const label = page.locator('.tabs-list-tab__text').and(page.getByText(title, { exact: true }));
    const tab = page.locator('.tabs__item-content').filter({ has: label });
    const active = tab.and(page.locator('.tabs__item-content.active'));
    if (!await active.count()) await tab.locator('.tabs__item-tab').click(timeout);
    await active.waitFor(timeout);
  }

  async function updateDiagram(page, item, index, write) {
    await selectTab(page, item.tabs[index]);
    const widget = page.locator(selector).locator('[data-node-type="drawioDiagram"]').nth(index);
    await widget.waitFor(timeout);
    const drawing = item.diagrams[index];
    const contents = widget.frameLocator('iframe').getByText(drawing.label, { exact: true }).first();
    const present = (duration = 1800) => contents.waitFor({ timeout: duration }).then(() => true, () => false);
    const drawingId = () => page.locator(selector).evaluate((el, index) => el.editor.getJSON().content
      .find(node => node.type === 'tabs')?.content[index]?.content.find(node => node.type === 'drawioDiagram')?.attrs.fileId, index);
    const fileExists = await drawingId();
    // В общей сборке предпросмотр проверяется при итоговом открытии. После записи iframe может показывать прежний кадр.
    if (write && !reloadAfterSave && fileExists) return true;
    if (!write) {
      await widget.scrollIntoViewIfNeeded(timeout);
      return present(timeout.timeout);
    }
    if (fileExists && await present()) return true;
    await widget.hover(timeout);
    await widget.locator('button:has(use[href="#icon-pen"])').click(timeout);
    const popup = page.locator('.popup:visible iframe').first();
    await popup.waitFor(timeout);
    const frame = popup.contentFrame();
    await frame.locator('.geDiagramContainer svg').first().waitFor({ ...timeout, state: 'attached' });
    const extras = frame.locator('.geMenubar').getByText('Дополнительно', { exact: true });
    const command = frame.getByText('Редактировать диаграмму...', { exact: true }).filter({ visible: true }).first();
    await extras.click(timeout);
    const menuOpened = await command.waitFor({ timeout: 1200 }).then(() => true, () => false);
    if (!menuOpened) await extras.click(timeout);
    await command.click(timeout);
    const dialog = frame.locator('.geDialog:visible');
    await dialog.locator('textarea').fill(drawing.xml, timeout);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click(timeout);
    await frame.getByText(drawing.label, { exact: true }).first().waitFor(timeout);
    await frame.getByRole('button', { name: 'Сохранить', exact: true }).click(timeout);
    const closed = await popup.waitFor({ timeout: 2000, state: 'hidden' }).then(() => true, () => false);
    if (!closed) {
      const exit = frame.getByRole('button', { name: 'Выйти', exact: true });
      await exit.click({ timeout: 2000 }).catch(async error => {
        if (await popup.isVisible()) throw error;
      });
      await popup.waitFor({ ...timeout, state: 'hidden' });
    }
    if (!reloadAfterSave) {
      await page.waitForFunction(({ selector, index }) => Boolean(document.querySelector(selector)?.editor?.getJSON().content
        .find(node => node.type === 'tabs')?.content[index]?.content.find(node => node.type === 'drawioDiagram')?.attrs.fileId),
      { selector, index }, timeout);
      return true;
    }
    if (await present(4500)) return true;
    await page.reload({ ...timeout, waitUntil: 'domcontentloaded' });
    await selectTab(page, item.tabs[index]);
    return present(4500);
  }

  const result = [];
  for (const item of plan.pages.filter(item => !target || item.target === target)) {
    const started = Date.now();
    try {
      const matchingUrl = url => new URL(url).origin + new URL(url).pathname === item.target;
      const page = useCurrent ? current :
        current.context().pages().find(tab => matchingUrl(tab.url())) ?? await current.context().newPage();
      if (!matchingUrl(page.url())) await page.goto(item.target, { ...timeout, waitUntil: 'domcontentloaded' });
      const editor = page.locator(selector);
      const heading = page.locator('[data-test-id="article-title"]');
      await editor.waitFor(timeout);
      await page.locator('.article-breadcrumbs a[href$="' + parentPath + '"]').first().waitFor(timeout);
      const read = () => editor.evaluate(element => element.editor.getJSON());
      const title = (await heading.innerText(timeout)).trim();
      if (title !== item.title && title !== item.previousTitle) throw new Error('Заголовок статьи отличается от плана.');
      const old = await read();
      const widgets = collect(old);
      const expected = compile(item, plan, widgets);
      const same = doc => JSON.stringify(signature(doc)) === JSON.stringify(signature(expected));
      if (!same(old)) {
        const source = JSON.stringify(old);
        const names = new Set((item.files ?? []).map(({ name }) => name));
        const staging = old.content.every(node => (node.type === 'paragraph' && !node.content?.length) ||
          (node.type === 'mediaWrapper' && node.content?.length === 1 &&
            names.has(node.content[0].attrs?._meta?.title?.normalize())));
        const sourceMatches = item.layout === 'preparation' && source.includes('Док 1') && source.includes('IXcellerate') ||
          item.layout === 'finish' && widgets.tabs && source.includes('Текс текс текс текст');
        if (!staging && !sourceMatches) throw new Error('В статье есть другое содержимое. Проверьте целевой макет перед заменой.');
      }
      if (mode === 'preview') {
        result.push({ url: item.target, blocks: old.content.map(node => node.type), alreadyFilled: same(old) });
        continue;
      }
      let changed = false;
      if (mode === 'apply' && (!same(old) || title !== item.title)) {
        for (const file of item.files ?? []) {
          if (widgets.media[file.name]) continue;
          await editor.focus();
          await editor.press('ControlOrMeta+End');
          await editor.press('Enter');
          await page.locator('.editor__menu input[type="file"]#editor-file-input').setInputFiles(file.path, timeout);
          await page.waitForFunction(({ selector, name }) => {
            const find = node => (node.type === 'media' && node.attrs?._uploaded &&
              node.attrs._meta?.attachmentId && node.attrs._meta.title?.normalize() === name) || node.content?.some(find);
            const doc = document.querySelector(selector)?.editor?.getJSON();
            return doc && find(doc);
          }, { selector, name: file.name }, timeout);
        }
        if (title !== item.title) {
          await heading.fill(item.title, timeout);
          await heading.press('Tab', timeout);
          await page.locator('.article-content-tree:visible .tree-item__text').and(page.getByText(item.title, { exact: true })).first().waitFor(timeout);
        }
        const doc = compile(item, plan, collect(await read()));
        await editor.evaluate((element, json) => {
          const tiptap = element.editor;
          if (!tiptap.isEditable) throw new Error('Статья открыта для чтения.');
          const model = tiptap.state.schema.nodeFromJSON(json);
          model.check();
          if (!tiptap.commands.setContent(model.toJSON(), true)) throw new Error('Teamly не принял макет.');
        }, doc);
        changed = true;
        await page.locator('.save-status__icon.succeeded').first().waitFor({ ...timeout, state: 'attached' });
        if (reloadAfterSave) {
          await page.reload({ ...timeout, waitUntil: 'domcontentloaded' });
          await editor.waitFor(timeout);
        }
      }
      if (!same(await read()) || (await heading.innerText(timeout)).trim() !== item.title) throw new Error('Сохранённый макет отличается от плана.');
      const diagrams = [];
      const diagramStarted = Date.now();
      if (item.layout === 'finish') {
        for (const [index, diagram] of item.diagrams.entries()) {
          if (!await updateDiagram(page, item, index, mode === 'apply')) throw new Error('Не подтверждена диаграмма «' + diagram.label + '».');
          diagrams.push(diagram.label);
        }
        await selectTab(page, item.tabs[0]);
      }
      if (checkMedia && item.mermaid) {
        const mermaid = editor.locator('.code-block-mermaid__content svg').first();
        await mermaid.scrollIntoViewIfNeeded(timeout);
        await mermaid.waitFor(timeout);
      }
      if (checkMedia && item.googleSheet) {
        const sheet = editor.locator('iframe[src*="docs.google.com/spreadsheets"]');
        await sheet.scrollIntoViewIfNeeded(timeout);
        await sheet.contentFrame().locator('table').first().waitFor(timeout);
      }
      if (checkMedia && item.files?.some(({ name }) => !widgets.media[name]?.content[0].attrs._meta.attachmentId)) {
        throw new Error('Не подтверждены сохранённые вложения.');
      }
      result.push({ url: item.target, title: item.title, changed, diagrams,
        blocks: (await read()).content.map(node => node.type), elapsedMs: Date.now() - started,
        ...(diagrams.length ? { diagramsMs: Date.now() - diagramStarted } : {}),
      });
    } catch (error) {
      const waiting = error.message.split('\n').find(line => line.includes('waiting for locator'))?.trim();
      result.push({ url: item.target, title: item.title, error: error.message.split('\n')[0], waiting, elapsedMs: Date.now() - started });
    }
  }
  return { ok: result.every(item => !item.error), mode, pages: result };
}
