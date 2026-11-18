import { readFile } from 'node:fs/promises';

export async function readWorkArticles(filename, space) {
  const articles = JSON.parse(await readFile(filename, 'utf8'));
  const scope = space.pages.filter(({ key, kind }) => kind !== 'database' && !/^SUPER(?:-\d+)?$/u.test(key));
  if (!Array.isArray(articles) || articles.length !== scope.length ||
      new Set(articles.map(article => article.key)).size !== scope.length ||
      scope.some(page => !articles.some(article => article.key === page.key))) {
    throw new Error('В плане рабочих статей должен быть один текст для каждой обычной статьи, включая корневую.');
  }
  const text = value => typeof value === 'string' && Boolean(value.trim());
  const keys = new Set(space.pages.map(page => page.key));
  const aiSection = space.demo?.aiSearch?.section;
  const aiSources = new Set(/^SEC-0[1-4]$/u.test(aiSection ?? '') ?
    scope.filter(page => page.parent === aiSection).map(page => page.key) : []);
  const prepared = articles.map(item => {
    const textOnly = aiSources.has(item.key);
    const sections = item.sections ?? (textOnly ? [] : undefined);
    if (!text(item.intro) || !Array.isArray(sections) || sections.some(section => ![section.title, section.text].every(text) ||
          (section.steps !== undefined && (!Array.isArray(section.steps) || !section.steps.length || !section.steps.every(text)))) ||
        (!textOnly && (!item.panel || !['info', 'note', 'ready', 'warning'].includes(item.panel.type) ||
          ![item.panel.title, item.panel.text].every(text) || !sections.length ||
          (item.links !== undefined && (!Array.isArray(item.links) || item.links.some(key => key === item.key || !keys.has(key))))))) {
      throw new Error('Проверьте ' + (textOnly ? 'текст статьи ' : 'текст, инфоплашку и ссылки статьи ') + item.key + '.');
    }
    return textOnly ? { key: item.key, intro: item.intro, sections, textOnly } : item;
  });
  return { host: space.host, layout: space.pages.map(({ key, title, parent, kind }) => ({ key, title, parent, kind })), articles: prepared };
}

export function bindWorkArticles(prepared, objects) {
  const scope = new Map(prepared.layout.map(page => [page.key, page]));
  const getUrl = key => {
    const item = scope.get(key);
    const url = new URL(objects[key]?.url);
    const type = item.kind === 'database' ? 'db' : 'at';
    const pattern = new RegExp('^/' + type + '/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$', 'iu');
    if (url.origin !== prepared.host || !pattern.test(url.pathname) || url.search || url.hash) {
      throw new Error('Неверный адрес ' + key + ' в журнале пространства.');
    }
    return url.href;
  };
  const root = getUrl('ROOT');
  const bound = prepared.articles.map(item => {
    const page = scope.get(item.key);
    return {
      ...item, root, url: getUrl(item.key), title: page.title, parent: page.parent ? getUrl(page.parent) : null,
      links: (item.links ?? []).map(key => ({
        title: scope.get(key).title, url: getUrl(key), nested: scope.get(key).parent === item.key,
      })),
    };
  });
  if (new Set(bound.map(article => article.url)).size !== bound.length) {
    throw new Error('В журнале одному адресу соответствует несколько рабочих статей.');
  }
  return bound;
}

export async function workArticle(page, article, mode) {
  const timeout = { timeout: 12000 };
  if (page.url() !== article.url) await page.goto(article.url, { ...timeout, waitUntil: 'domcontentloaded' });
  const heading = page.locator('[data-test-id="article-title"]').first();
  const body = page.locator('.editor__editor > .tiptap.ProseMirror');
  const breadcrumbs = page.locator('.article-breadcrumbs');
  await Promise.all([body.waitFor(timeout), heading.waitFor(timeout), breadcrumbs.waitFor(timeout)]);
  if (article.parent) {
    await breadcrumbs.locator('a[href=' + JSON.stringify(article.parent) + ']').waitFor(timeout);
  }
  const [title, trail] = await Promise.all([heading.innerText(timeout),
    breadcrumbs.locator('a[href]').evaluateAll(links => links.map(link => link.href))]);
  if (page.url() !== article.url || title.trim() !== article.title ||
      (article.parent ? !trail.includes(article.root) : article.url !== article.root) ||
      await page.getByRole('button', { name: 'Опубликовать', exact: true }).isVisible()) {
    throw new Error('Не подтверждены название, пространство или статус публикации.');
  }
  const readOrWrite = () => body.evaluate((element, { article, mode }) => {
    const editor = element.editor;
    const node = (type, content, attrs) => ({ type, ...(attrs && { attrs }), ...(content?.length && { content }) });
    const text = (value, marks) => ({ type: 'text', text: value, ...(marks && { marks }) });
    const p = (value, marks) => node('paragraph', [text(value, marks)], { id: crypto.randomUUID() });
    const heading = value => node('heading', [text(value)], { id: crypto.randomUUID(), level: 2 });
    const panel = article.panel ? [node('panel', [
      p(article.panel.title, [{ type: 'bold' }]), p(article.panel.text),
    ], { id: crypto.randomUUID(), type: article.panel.type })] : [];
    const sections = article.sections.flatMap(section => [
      heading(section.title), p(section.text),
      ...(section.steps ? [node('bullet_list', section.steps.map(step => node('list_item', [p(step)])))] : []),
    ]);
    const links = items => items.length ? [node('bullet_list', items.map(link =>
      node('list_item', [p(link.title, [{ type: 'link', attrs: { link: { url: link.url, type: 'external' } } }])])))] : [];
    const materials = article.links.length ? [heading('Связанные материалы')] : [];
    const prefix = [p(article.intro), ...panel, ...sections, ...materials];
    const current = editor.getJSON();
    const navigation = current.content.filter(block => block.type === 'nestedArticles');
    const blank = block => block.type === 'paragraph' && !block.content?.length;
    const hasNested = article.links.some(link => link.nested);
    const format = content => editor.state.schema.nodeFromJSON(node('doc', content));
    const document = hasNested
      ? format([...prefix, ...navigation, ...links(article.links.filter(link => !link.nested))])
      : format([...prefix, ...links(article.links), ...navigation]);
    document.check();
    const signature = value => [
      value.type, value.text, value.type === 'panel' ? value.attrs?.type : undefined,
      value.marks?.map(mark => [mark.type, mark.attrs?.link?.url]), value.content?.map(signature),
    ];
    const withoutTrailingBlank = value => {
      const content = value.content.slice();
      while (content.length && blank(content.at(-1))) content.pop();
      return { ...value, content };
    };
    const matches = (one, two) =>
      JSON.stringify(signature(withoutTrailingBlank(one))) === JSON.stringify(signature(withoutTrailingBlank(two)));
    if ((!hasNested || navigation.length === 1) && matches(current, document.toJSON())) {
      return { status: 'already', count: current.content.length };
    }
    if (mode === 'verify') throw new Error(article.textOnly ?
      'Сохранённый текст статьи отличается от плана.' : 'Сохранённый текст или инфоплашка отличаются от плана.');
    const withoutNavigation = { ...current, content: current.content.filter(block => block.type !== 'nestedArticles') };
    const legacy = format([...prefix, ...links(article.links)]);
    if (navigation.length > 1 || (!withoutNavigation.content.every(blank) && !matches(withoutNavigation, legacy.toJSON()))) {
      throw new Error('В теле статьи уже есть другое содержимое.');
    }
    if (mode === 'preview') return { status: 'ready', count: current.content.length };
    if (hasNested && navigation.length === 0) return { status: 'insertNavigation' };
    if (!editor.isEditable || !editor.commands.setContent(document.toJSON(), true)) {
      throw new Error('Teamly не принял текст статьи.');
    }
    return { status: 'written', count: document.childCount };
  }, { article, mode });
  let expected = await readOrWrite();
  if (expected.status === 'insertNavigation') {
    await body.evaluate(element => {
      const editor = element.editor;
      const { doc } = editor.state;
      if (doc.lastChild?.type.name !== 'paragraph' || doc.lastChild.content.size) {
        editor.commands.insertContentAt(doc.content.size, { type: 'paragraph' });
      }
      editor.commands.focus('end');
    });
    await page.locator('.editor__menu button.dropdown__trigger-button:has(use[href="#icon-plus"]):visible').click(timeout);
    await page.getByRole('button', { name: 'Вывод вложенных статей', exact: true }).click(timeout);
    await page.waitForFunction(() => document.querySelector('.editor__editor > .tiptap.ProseMirror')?.editor?.getJSON()
      .content.some(block => block.type === 'nestedArticles'), null, timeout);
    expected = await readOrWrite();
    if (expected.status === 'insertNavigation') throw new Error('Нативный вывод вложенных статей не добавился.');
  }
  if (expected.status === 'written') {
    await page.locator('.save-status__icon.succeeded').first().waitFor({ ...timeout, state: 'attached' });
  }
  if (mode === 'verify' || expected.status === 'written') {
    await body.getByText(article.panel?.title ?? article.intro, { exact: true }).first().waitFor(timeout);
  }
  if (mode === 'verify') {
    for (const link of article.links.filter(link => link.nested)) {
      await body.getByText(link.title, { exact: true }).first().waitFor(timeout);
    }
  }
  return { key: article.key, url: article.url, title, ...expected };
}

export async function runWorkArticleBatch(current, articles, mode, writeArticle) {
  const tasks = articles.slice();
  const rows = [];
  const workers = Array.from({ length: Math.min(4, tasks.length) }, async () => {
    const page = await current.context().newPage();
    try {
      while (tasks.length) {
        const article = tasks.shift();
        const started = Date.now();
        try {
          rows.push({ ...await writeArticle(page, article, mode), elapsedMs: Date.now() - started });
        } catch (error) {
          rows.push({ key: article.key, url: article.url, title: article.title, error: error.message.split('\n')[0] });
        }
      }
    } finally {
      await page.close();
    }
  });
  await Promise.all(workers);
  return articles.map(article => rows.find(row => row.key === article.key));
}

export function workArticleHandlers(current, plan, bind, batch, writeArticle) {
  return {
    async fill(state, save) {
      state.content ??= {};
      const pending = bind(plan, state.objects).filter(article => !state.content[article.key]?.written);
      const results = await batch(current, pending, 'apply', writeArticle);
      for (const result of results) {
        state.content[result.key] = { ...result, kind: 'work', written: !result.error };
      }
      await save();
      const failed = results.filter(result => result.error);
      if (failed.length) throw new Error(failed.map(result => result.key + ' — ' + result.error).join(' | '));
      return results;
    },
    async verify(page, item, state) {
      const article = bind(plan, state.objects).find(article => article.key === item.key);
      state.content[item.key].verification = await writeArticle(page, article, 'verify');
    },
  };
}
