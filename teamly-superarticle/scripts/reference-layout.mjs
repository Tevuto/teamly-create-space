import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const standardVideo = 'https://rutube.ru/video/44781d635431617e3d720b9ca2619e12/?r=wd';

async function checkRoundedImage(file, faq) {
  const png = await readFile(file);
  if (png.length < 33 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      png[24] !== 8 || png[25] !== 6 || png[28] !== 0) {
    throw new Error('Иллюстрация должна быть PNG с прозрачными скруглёнными углами: ' + basename(file));
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (faq && (width < 750 || height > 100)) {
    throw new Error('Иллюстрация для вопросов должна быть широкой полосой высотой не более 100 px: ' + basename(file));
  }
  const chunks = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    if (offset + length + 12 > png.length) throw new Error('Повреждён файл ' + basename(file));
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const data = inflateSync(Buffer.concat(chunks), { maxOutputLength: 40_000_000 });
  // Первый пиксель первой строки фильтруется с нулевыми соседями.
  if (data.length !== (4 * width + 1) * height || data[4] !== 0) {
    throw new Error('У иллюстрации нет прозрачного скругления: ' + basename(file));
  }
}

export async function readSuperarticlePlan(filename, plan = undefined) {
  plan ??= JSON.parse(await readFile(filename, 'utf8'));
  const target = new URL(plan.target);
  const validArticle = url => url.protocol === 'https:' && url.origin === target.origin &&
    /^\/at\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(url.pathname) && !url.search && !url.hash;
  const text = value => typeof value === 'string' && Boolean(value.trim());
  const array = (value, length, validate = text) => Array.isArray(value) && value.length === length && value.every(validate);
  if (!validArticle(target) || !text(plan.title) || !array(plan.headings, 5) ||
      ![plan.intro, plan.callout, plan.conclusion].every(text) || !array(plan.checklist, 4) ||
      !array(plan.checkpoints, 4, row => array(row, 4)) || !array(plan.faq, 3, item =>
        text(item.question) && array(item.panels, 2, panel => array(panel, 2))) ||
      (plan.children && (!array(plan.children, 3, item => validArticle(new URL(item))) ||
        new Set(plan.children).size !== 3 || plan.children.includes(plan.target)))) {
    throw new Error('Неполный план суперстатьи или некорректные URL.');
  }
  if (plan.assets) {
    plan.assets.video ??= standardVideo;
    const { images, video, changeLog } = plan.assets;
    if (!Array.isArray(images) || images.length > 2 ||
        !images.every(file => text(file) && /\.(?:png|jpe?g|webp|gif)$/iu.test(file)) ||
        new Set(images.map(file => basename(file).normalize())).size !== images.length ||
        !/^https:\/\/(?:rutube\.ru\/video\/|(?:www\.)?vkvideo\.ru\/video)/u.test(video) ||
        !Array.isArray(changeLog) || changeLog.length < 2 || !changeLog.every(row => array(row, 2))) {
      throw new Error('Проверьте изображения, ссылку на Rutube или VK и таблицу изменений.');
    }
    plan.assets.images = images.map(file => resolve(dirname(filename), file));
    for (const [index, file] of plan.assets.images.entries()) {
      if (!(await stat(file)).isFile()) throw new Error('Нет файла изображения: ' + file);
      if (plan.assets.presentation === 'full-width-faq') await checkRoundedImage(file, index === 1);
    }
  }
  return plan;
}

// Native ProseMirror nodes in the order observed in the example article.
export function superarticleLayout(plan, widgets = {}) {
  const ids = () => ({ id: crypto.randomUUID() });
  const block = (type, content, attrs = {}) => ({ type, attrs: { ...ids(), ...attrs }, ...(content?.length && { content }) });
  const node = (type, content) => ({ type, content });
  const bold = [{ type: 'bold' }];
  const text = (value, marks) => ({ type: 'text', text: value, ...(marks && { marks }) });
  const paragraph = (value, marks) => block('paragraph', value ? [text(value, marks)] : []);
  const heading = (level, value, emphasized = false) => block('heading', [text(value, emphasized ? bold : undefined)], { level });
  const column = (width, content) => ({ type: 'layoutColumn', attrs: { width }, content });
  const layout = (...columns) => block('layoutSection', columns);
  const panel = (type, ...content) => block('panel', content, { type });
  const table = (matrix, widths) => block('table', matrix.map((row, y) => block('table_row',
    row.map((value, x) => block('table_cell', [paragraph(value, y === 0 ? bold : undefined)], {
      colspan: 1, rowspan: 1, colwidth: [widths[x]], color: y % 2 ? 'tropical-blue' : 'perano',
    })))), { mode: 'base', visibility: 'visible', labels: [] });
  const compare = (type, [label, detail]) => panel(type, paragraph(label, [
    { type: 'fontSize', attrs: { fontSize: 20, display: 'inline', overflowWrap: 'anywhere' } },
    { type: 'fontStyle', attrs: { fontFamily: 'Oswald', fontWeight: type === 'ready' ? 600 : 700 } },
    ...bold, { type: 'text_color', attrs: { color: { ready: '#38761d', warning: '#f1c232', error: '#cc0000' }[type] } },
  ]), paragraph(detail));
  const image = index => {
    const media = widgets.images?.[index] ?? { type: 'media' };
    const width = plan.assets && index === 1 && plan.assets.presentation !== 'full-width-faq' ? 600 : undefined;
    return block('mediaWrapper', [
      width ? { ...media, attrs: { ...media.attrs, width } } : media,
    ], { layout: 'center', ...(width && { width }) });
  };
  const faq = plan.faq.map(({ question, panels }, index) => block('expandSection', [
    node('expandTitle', [text(question, bold)]),
    node('expandContent', [layout(column(50, [compare('ready', panels[0])]),
      column(50, [compare(index ? 'error' : 'warning', panels[1])]))]),
  ]));
  const [prepare, schedule, questions, finish, updates] = plan.headings;
  return {
    doc: node('doc', [
      plan.assets && !plan.assets.images.length ? block('tableOfContents') :
        layout(column(66.66, [image(0)]), column(33.33, [block('tableOfContents')])),
      heading(1, prepare, true), paragraph(plan.intro), block('horizontal_rule'),
      layout(column(33.33, [block('todo_list', plan.checklist.map(value => block('todo_item', [paragraph(value)],
        { checked: false, done: false })))]), column(66.66, [block('blockquote', [paragraph(plan.callout)])])),
      heading(1, schedule, true), table(plan.checkpoints, [65, 263, 200, 200]),
      heading(2, questions, true),
      ...(!plan.assets || plan.assets.images.length === 2 ? [paragraph(), image(1), paragraph()] : []), ...faq,
      heading(1, finish), paragraph(), panel('info', paragraph(plan.conclusion)), paragraph(),
      ...(!plan.assets || plan.assets.video ? [block('remote_video', [], {
        src: plan.assets?.video, width: '750', height: '450', layout: 'center', accept: ['rutube', 'vk'],
      })] : []),
      heading(3, updates), widgets.sync ?? block('syncedContent'), paragraph(),
    ]),
    changeLog: plan.assets && node('doc', [table(plan.assets.changeLog, [250, 450])]),
  };
}

export async function runSuperarticle(current, plan, mode, makeLayout, {
  useCurrent = false, reloadAfterSave = true, checkCards = true, checkMedia = false,
} = {}) {
  const timeout = { timeout: 12000 };
  const page = useCurrent ? current :
    current.context().pages().find(tab => tab.url() === plan.target) ?? await current.context().newPage();
  if (page.url() !== plan.target) await page.goto(plan.target, { ...timeout, waitUntil: 'domcontentloaded' });
  const editor = page.locator('.editor__editor > .tiptap.ProseMirror');
  await editor.waitFor(timeout);
  await page.getByTestId('article-title').or(page.locator('[data-test-id="article-title"]'))
    .filter({ hasText: plan.title }).first().waitFor(timeout);
  if ((await page.locator('[data-test-id="article-title"]').first().innerText(timeout)).trim() !== plan.title) {
    throw new Error('Заголовок статьи отличается от плана.');
  }

  if (checkCards && plan.children) {
    await page.waitForFunction(paths => {
      const actual = [...document.querySelectorAll('.article-nested-articles a[href]')].map(link => link.pathname);
      return paths.length === actual.length && paths.every((path, i) => path === actual[i]);
    }, plan.children.map(url => new URL(url).pathname), timeout);
  }

  const blueprint = makeLayout(plan);
  const names = plan.assets?.images.map(path => path.split(/[/\\]/u).at(-1).normalize()) ?? [];
  const inspect = () => editor.evaluate((element, names) => {
    const state = element.editor?.state;
    if (!state) throw new Error('Компоненты редактора Teamly ещё не готовы.');
    const doc = state.doc.toJSON();
    const uploaded = {};
    let sync;
    const staging = doc.content.every(block => {
      if (block.type === 'paragraph') return !block.content?.length;
      if (block.type === 'syncedContent' && block.attrs.contentId && !sync) {
        sync = block;
        return true;
      }
      if (block.type !== 'mediaWrapper' || block.content?.length !== 1) return false;
      const media = block.content[0];
      const name = media.attrs?._meta?.title?.normalize();
      if (media.type !== 'media' || !names.includes(name) || uploaded[name]) return false;
      uploaded[name] = media;
      return true;
    });
    return { staging, sync, uploaded, editable: element.editor.isEditable };
  }, names);

  async function applyContent(template, update) {
    return editor.evaluate((element, { expected, update }) => {
      const tiptap = element.editor;
      const { doc, schema } = tiptap.state;
      const changes = [];
      let nativeBlocks = 0;
      function match(actual, planned, position, path) {
        if (actual.type.name !== planned.type || actual.childCount !== (planned.content?.length ?? 0)) {
          throw new Error('Блок ' + path + ': ожидался ' + planned.type + ', получен ' + actual.type.name + '.');
        }
        if (actual.isText) {
          if (actual.text !== planned.text) changes.push({ actual, text: planned.text, position });
          return;
        }
        nativeBlocks += 1;
        actual.forEach((child, offset, index) => match(child, planned.content[index],
          position + (actual === doc ? 0 : 1) + offset, path + '.' + (index + 1)));
      }
      match(doc, expected, 0, 'doc');
      if (update && changes.length) {
        if (!tiptap.isEditable) throw new Error('Статья открыта без доступа к редактированию.');
        const transaction = tiptap.state.tr;
        for (const { actual, text, position } of changes.reverse()) {
          transaction.replaceWith(position, position + actual.nodeSize, schema.text(text, actual.marks));
        }
        tiptap.view.dispatch(transaction);
      }
      return { changed: changes.length, topLevel: doc.childCount, nativeBlocks };
    }, { expected: template, update });
  }

  const initial = await inspect();
  let result;
  if (!initial.staging) result = await applyContent(blueprint.doc, mode === 'apply');
  else {
    if (!plan.assets) throw new Error('Для заполнения пустой статьи нужны материалы assets.');
    if (mode === 'preview') return { ok: true, url: plan.target, mode, status: 'Пустая статья готова к сборке' };
    if (mode === 'verify') throw new Error('Структура и содержание статьи ещё не сохранены.');
    if (!initial.editable) throw new Error('Статья открыта без доступа к редактированию.');
    const syncKey = 'codex:teamly-superarticle-sync:' + new URL(plan.target).pathname;
    const ownSync = await page.evaluate(key => localStorage.getItem(key), syncKey);
    if (initial.sync && ownSync !== initial.sync.attrs.contentId && ownSync !== 'pending') {
      throw new Error('У таблицы изменений уже есть привязка к синхронизированному блоку другого запуска.');
    }
    for (const [index, name] of names.entries()) {
      if ((await inspect()).uploaded[name]) continue;
      await editor.focus();
      await editor.press('ControlOrMeta+End');
      await editor.press('Enter');
      const input = page.locator('.editor__menu input[type="file"]#editor-file-input');
      await input.setInputFiles(plan.assets.images[index], timeout);
      await page.waitForFunction(name => document.querySelector('.editor__editor > .tiptap.ProseMirror')?.editor?.getJSON()
        .content.some(block => {
          const attrs = block.content?.[0]?.attrs;
          return block.type === 'mediaWrapper' && attrs?._uploaded && attrs._meta?.attachmentId && attrs._meta.title?.normalize() === name;
        }), name, timeout);
    }
    if (!initial.sync) {
      await page.evaluate(key => localStorage.setItem(key, 'pending'), syncKey);
      await editor.focus();
      await editor.press('ControlOrMeta+End');
      await editor.press('Enter');
      await page.locator('.editor__menu button.dropdown__trigger-button:has(use[href="#icon-plus"]):visible').click(timeout);
      await page.getByRole('button', { name: 'Синхронизированный блок', exact: true }).click(timeout);
    }
    const synced = editor.locator('.synced-content .tiptap[contenteditable="true"]');
    await synced.waitFor(timeout);
    const staged = await inspect();
    if (!staged.sync) throw new Error('Новый синхронизированный блок не подтвердился.');
    await page.evaluate(({ key, id }) => localStorage.setItem(key, id), { key: syncKey, id: staged.sync.attrs.contentId });
    await synced.evaluate((element, doc) => {
      const model = element.editor.state.schema.nodeFromJSON(doc);
      model.check();
      if (!element.editor.commands.setContent(model.toJSON(), true)) throw new Error('Teamly не сохранил журнал изменений.');
    }, blueprint.changeLog);
    const final = makeLayout(plan, { images: names.map(name => staged.uploaded[name]), sync: staged.sync });
    await editor.evaluate((element, doc) => {
      const model = element.editor.state.schema.nodeFromJSON(doc);
      model.check();
      if (!element.editor.commands.setContent(model.toJSON(), true)) throw new Error('Teamly не принял макет.');
    }, final.doc);
    result = { ...(await applyContent(blueprint.doc, false)), changed: 'создан макет' };
  }

  if (mode === 'apply' && result.changed) {
    const saved = page.locator('.save-status__icon.succeeded');
    await saved.first().waitFor({ ...timeout, state: 'attached' });
    if (reloadAfterSave) {
      await page.reload({ ...timeout, waitUntil: 'domcontentloaded' });
      await editor.waitFor(timeout);
    }
  }
  const verified = await applyContent(blueprint.doc, false);
  if (mode !== 'preview' && verified.changed) throw new Error('Часть текста не сохранилась после открытия статьи.');
  if (checkMedia) {
    const synced = editor.locator('.synced-content .tiptap');
    await synced.getByText(plan.assets.changeLog[1][1], { exact: true }).waitFor(timeout);
    const images = editor.locator('[data-node-type="media"] img');
    const sizes = [];
    for (const [index, name] of names.entries()) {
      const image = images.nth(index);
      await image.scrollIntoViewIfNeeded(timeout);
      const size = await image.evaluate(async img => {
        await img.decode();
        const frame = img.closest('[data-node-type="mediaWrapper"]');
        return { width: img.clientWidth, height: img.clientHeight, ratio: img.naturalWidth / img.naturalHeight,
          frameWidth: frame?.clientWidth };
      });
      const compactFaq = plan.assets.presentation === 'full-width-faq';
      const invalidFaq = compactFaq
        ? size.height > 100 || !size.frameWidth || size.frameWidth - size.width > 12
        : size.ratio < 2.8 || size.ratio > 3.2 || size.height > 250;
      if (!size.width || (index === 1 && invalidFaq)) {
        throw new Error('Не подтверждено отображение иллюстрации «' + name + '».');
      }
      sizes.push({ name, ...size });
    }
    const video = editor.locator('iframe[src*="rutube.ru"], iframe[src*="vkvideo.ru"], iframe[src*="vk.com/video_ext"]');
    await video.scrollIntoViewIfNeeded(timeout);
    const videoId = new URL(plan.assets.video).pathname.split('/').filter(Boolean).at(-1);
    if (!(await video.getAttribute('src', timeout))?.includes(videoId)) throw new Error('Встроен другой ролик.');
    await video.contentFrame().locator('video, [class*="player"]').first().waitFor({ ...timeout, state: 'attached' });
    return { ok: true, url: plan.target, mode, ...result, verified: true, images: sizes, video: plan.assets.video };
  }
  return { ok: true, url: plan.target, mode, ...result, verified: mode !== 'preview' };
}
