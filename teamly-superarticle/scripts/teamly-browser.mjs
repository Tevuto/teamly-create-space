import { access, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { inflateRawSync } from 'node:zlib';
import { articleFiles, articleMarkup, comparisonHeadingColors, comparisonHeadingFont, criteriaMarkup, drawioUrl, trailingWidget } from './layout.mjs';
import { generateOrgChart } from './drawio-org.mjs';
import { compileProcess } from './mermaid-process.mjs';

const order = ['main', 'process', 'documents', 'map'];
// Teamly lists sibling drafts newest first. Create them in reverse display order.
const creationOrder = [order[0], ...order.slice(1).reverse()];
const timeout = 12_000;
const editorSelector = '.editor__editor > .tiptap.ProseMirror';
const articlePath = /^\/at\/[\da-f-]{36}\/?$/i;
const drawioViewer = 'https://viewer.diagrams.net/';
const forbidden = /демо[-\s‑–]+(?:данные|маршрут)|вымышленные данные|для демонстрации/iu;
const standaloneTitles = /^(суперстатья|схемы|документы|iframe)$/iu;
const pdf = /\.pdf$/iu;
const image = /\.(png|jpe?g|webp|gif)$/iu;
const video = /\.(mp4|webm|mov)$/iu;
const json = value => JSON.stringify(value, null, 2) + '\n';
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };

function httpsUrl(value) {
  const url = new URL(value);
  requireValue(url.protocol === 'https:' && !url.username && !url.password, `Ожидалась ссылка HTTPS: ${url.origin}`);
  return url;
}

async function readPlan(file, { allowLegacyComparison }) {
  const source = await readFile(file, 'utf8');
  const plan = JSON.parse(source);
  const space = httpsUrl(plan.space);
  requireValue(/^\/sp\/[\da-f-]{36}\/?$/i.test(space.pathname), 'Укажите ссылку на пространство Teamly (/sp/…).');
  if (plan.parent) {
    const parent = httpsUrl(plan.parent);
    requireValue(parent.origin === space.origin && articlePath.test(parent.pathname), 'Родительская статья должна находиться в том же Teamly.');
  }
  requireValue(plan.version === 1, 'Поддерживается план версии 1.');
  requireValue(!forbidden.test(source), 'План содержит служебную пометку.');
  requireValue(Object.keys(plan.pages ?? {}).length === 4, 'План должен содержать четыре страницы.');
  const titles = order.map(key => plan.pages[key]?.title);
  requireValue(titles.every(title => typeof title === 'string' && title.trim() && !standaloneTitles.test(title.trim()))
    && new Set(titles).size === 4, 'У четырёх страниц должны быть разные рабочие названия.');
  const { main, process, documents, map } = plan.pages;
  requireValue(Array.isArray(main.disclosures) && main.disclosures.length === 3, 'Добавьте три раскрывающихся блока.');
  requireValue(main.disclosures[0]?.comparison || (allowLegacyComparison && image.test(main.disclosures[0]?.image)),
    'В первый раскрывающийся блок добавьте comparison с инфоблоками.');
  for (const item of main.disclosures) {
    if (item.comparison === undefined) continue;
    const cards = item.comparison;
    requireValue(Array.isArray(cards) && cards.length >= 2 && cards.length <= 3 &&
      cards.every(card => card && Object.hasOwn(comparisonHeadingColors, card.tone) &&
        [card.title, card.text].every(value => typeof value === 'string' && value.trim())) &&
      new Set(cards.map(card => card.tone)).size === cards.length && !item.image,
    'Для comparison укажите 2–3 инфоблока с разными tone (ready, warning, note), заголовками и тезисами. Уберите image из этого раскрывающегося блока.');
  }
  requireValue(image.test(main.hero) && image.test(main.form) && video.test(main.video), 'Главной нужны две инфографики и видео.');
  requireValue(documents.files.length === 4 && documents.files.every(file => pdf.test(file)),
    'Нужны четыре PDF.');
  requireValue(documents.figures.length === 4 && documents.figures.every(item => item.caption && image.test(item.file)),
    'Нужны четыре иллюстрации с подписями.');
  requireValue(plan.criteria?.title && plan.criteria.items?.length, 'Добавьте критерии проверки для синкблока.');
  const local = path => resolve(dirname(file), path);
  const section = process.process;
  let processDiagram;
  if (section.workflow !== undefined) {
    requireValue(section.mermaid === undefined, 'Укажите один источник Mermaid: workflow или mermaid.');
    const workflow = typeof section.workflow === 'string'
      ? JSON.parse(await readFile(local(section.workflow), 'utf8')) : section.workflow;
    processDiagram = compileProcess(workflow);
    section.mermaid = processDiagram.source;
    requireValue(!forbidden.test(section.mermaid), 'Диаграмма Mermaid содержит служебную пометку.');
  }
  requireValue(typeof section.mermaid === 'string' && section.mermaid.trim(), 'Добавьте исходный текст Mermaid.');
  if (processDiagram || section.outcome !== undefined) {
    requireValue([section.text, section.note?.title, section.note?.text, section.outcome]
      .every(value => typeof value === 'string' && value.trim()),
    'Для процесса добавьте краткое описание, пояснение к этапам и участникам и ожидаемый результат.');
    section.title = 'Как устроен бизнес-процесс';
  }
  httpsUrl(map.widget.url);
  httpsUrl(map.original.url);
  if (documents.example.kind === 'google-docs') {
    const doc = httpsUrl(documents.example.url);
    requireValue(doc.hostname === 'docs.google.com' && doc.pathname.startsWith('/document/'),
      'Укажите адрес встраивания существующего Google Docs.');
  } else {
    requireValue(documents.example.kind === 'teamly' && documents.example.rows?.length > 1,
      'Укажите Google Docs или строки заполненного образца в Teamly.');
  }
  for (const key of order) {
    const filenames = articleFiles(plan, key).map(file => basename(file).normalize());
    requireValue(new Set(filenames).size === filenames.length, `Повторяется имя файла на странице «${plan.pages[key].title}».`);
  }
  const attachments = [...new Set(order.flatMap(key => articleFiles(plan, key)))];
  await Promise.all(attachments.map(path => access(local(path))));
  const diagram = process.owners.diagram;
  requireValue(!diagram || (diagram.kind === 'org-chart' && typeof diagram.spec === 'string' &&
    typeof diagram.output === 'string' && !process.owners.drawio),
    'Укажите готовый файл owners.drawio или owners.diagram с kind: org-chart, spec и output.');
  let diagramInfo;
  let xml;
  if (diagram) {
    const output = local(diagram.output);
    const generated = await generateOrgChart(local(diagram.spec), output);
    ({ xml } = generated);
    diagramInfo = { file: output, cards: generated.cards, segments: generated.segments };
  } else {
    requireValue(typeof process.owners.drawio === 'string', 'Укажите .drawio в поле owners.drawio.');
    xml = await readFile(local(process.owners.drawio), 'utf8');
  }
  requireValue(/<mx(?:file|GraphModel)\b/u.test(xml), 'Файл структуры компании должен содержать диаграмму Draw.io.');
  const orgChart = drawioUrl(xml);
  // Compile every layout before launching Chrome, so missing content fails before any mutation.
  const placeholders = Object.fromEntries(attachments.map(path => [path, '<p>Файл</p>']));
  for (const key of order) articleMarkup(plan, key, placeholders, { synced: '<p>Критерии</p>' });
  const fingerprint = createHash('sha256').update(source);
  if (processDiagram) fingerprint.update(processDiagram.source);
  if (diagram) fingerprint.update(xml);
  return { plan, space, local, orgChart, diagramInfo, diagramSource: xml, processDiagram, fingerprint: fingerprint.digest('hex') };
}

async function waitForAny(locators, duration = timeout) {
  return Promise.any(locators.map(locator => locator.waitFor({ state: 'visible', timeout: duration }).then(() => locator)))
    .catch(() => null);
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function articleEditor(page, editable = false) {
  return page.locator(editorSelector + (editable ? '[contenteditable="true"]' : ''));
}

async function copyEditor(editor) {
  const serialized = await editor.evaluate(element => element.editor?.getHTML?.() ?? null);
  if (serialized !== null) return serialized;
  const editable = await editor.getAttribute('contenteditable') === 'true';
  if (editable) await editor.press('ControlOrMeta+a');
  return editor.evaluate(async (element, alreadySelected) => {
    const selection = window.getSelection();
    const previous = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    if (!alreadySelected) {
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    // Allow the editor to observe the browser selection before asking it to copy.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent('copy', {
      bubbles: true, cancelable: true, clipboardData: data,
    }));
    selection.removeAllRanges();
    if (previous?.startContainer.isConnected && previous.endContainer.isConnected) selection.addRange(previous);
    return data.getData('text/html');
  }, editable);
}

async function setEditorContent(editor, html, widget = null) {
  const updated = await editor.evaluate((element, { source, widget }) => {
    const tiptap = element.editor;
    if (!tiptap?.isEditable || typeof tiptap.commands.setContent !== 'function') return false;
    // Use the editor transaction so the application's autosave and collaboration receive the change.
    if (!tiptap.commands.setContent(source, true)) return false;
    if (!widget) return true;
    const content = tiptap.getJSON();
    content.content.push(widget);
    return tiptap.commands.setContent(content, true);
  }, { source: html, widget });
  requireValue(updated, 'Редактор Teamly отклонил обновление содержимого.');
}

async function clipboardBlocks(page, html) {
  return page.evaluate(source => {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const synced = [...doc.querySelectorAll('[data-node-type="syncedContent"]')].map(element => {
      element.removeAttribute('data-pm-slice');
      return { html: element.outerHTML, id: element.dataset.contentId };
    });
    return { synced };
  }, html);
}

async function uploadedMedia(editor) {
  return editor.locator('[data-node-type="media"][data-meta]').evaluateAll(elements => Object.fromEntries(
    elements.flatMap(element => {
      const title = JSON.parse(element.getAttribute('data-meta') || '{}').title;
      if (!title || !element.getAttribute('data-src') || !element.getAttribute('data-context')) return [];
      const content = document.createElement('div');
      for (const name of ['data-node-type', 'data-id', 'data-src', 'data-external', 'data-meta',
        'data-context', 'data-mimetype', 'data-width', 'data-height']) {
        if (element.hasAttribute(name)) content.setAttribute(name, element.getAttribute(name));
      }
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-node-type', 'mediaWrapper');
      wrapper.setAttribute('data-layout', 'center');
      wrapper.append(content);
      return [[title.normalize(), wrapper.outerHTML]];
    })
  ));
}

async function addMenu(page) {
  const command = page.getByRole('button', { name: 'Макеты', exact: true });
  const plus = page.locator('.editor__menu button.dropdown__trigger-button:has(use[href="#icon-plus"])').filter({ visible: true });
  if (await plus.count() === 1) {
    await plus.click();
    if (await waitForAny([command], 1500)) return;
  }
  const named = page.getByRole('button', { name: /^(Добавить блок|Вставить блок|Добавить)$/iu }).first();
  if (await named.isVisible()) {
    await named.click();
    if (await waitForAny([command], 1500)) return;
  }
  // The insert button is the last control in the article toolbar containing the font selector.
  const font = page.getByRole('button', { name: 'Open Sans', exact: true }).first();
  const toolbar = font.locator('xpath=ancestor::*[.//button[contains(normalize-space(.), "AI")]][1]');
  if (await toolbar.count() === 1) {
    await toolbar.getByRole('button').last().click();
    if (await waitForAny([command], 1500)) return;
  }
  throw new Error('Не открылось меню вставки блоков Teamly.');
}

async function upload(page, editor, path) {
  await editor.focus();
  await editor.press('ControlOrMeta+End');
  await editor.press('End');
  await editor.press('Enter');
  const toolbarInput = page.locator('.editor__menu input[type="file"]#editor-file-input');
  if (await toolbarInput.count() === 1) {
    await toolbarInput.setInputFiles(path);
  } else {
    await addMenu(page);
    const command = image.test(path) ? 'Изображение' : 'Файл';
    const label = page.getByText(command, { exact: true }).filter({ visible: true }).last();
    const wrapper = label.locator('xpath=ancestor::*[.//input[@type="file"]][1]');
    if (await wrapper.count() === 1 && await wrapper.locator('input[type="file"]').count() === 1) {
      await wrapper.locator('input[type="file"]').setInputFiles(path);
    } else {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout }), label.click()]);
      await chooser.setFiles(path);
    }
  }
  await page.keyboard.press('Escape');
  const name = basename(path).normalize();
  const deadline = Date.now() + 25_000;
  do {
    const blocks = await uploadedMedia(editor);
    if (blocks[name]) return blocks[name];
    await page.waitForTimeout(350);
  } while (Date.now() < deadline);
  throw new Error(`Файл «${name}» не появился в редакторе.`);
}

async function pollClipboard(page, editor, pick, step) {
  const deadline = Date.now() + 30_000;
  do {
    const html = await copyEditor(editor);
    const result = pick(await clipboardBlocks(page, html));
    if (result) return result;
    await page.waitForTimeout(350);
  } while (Date.now() < deadline);
  throw new Error(`${step} не подтвердился в редакторе.`);
}

async function createSync(page, editor, plan) {
  await editor.focus();
  await editor.press('ControlOrMeta+End');
  await editor.press('Enter');
  await addMenu(page);
  await page.getByRole('button', { name: 'Синхронизированный блок', exact: true }).click();
  const inside = page.locator('.synced-content .tiptap[contenteditable="true"]').first();
  await inside.waitFor({ timeout: 20_000 });
  if (!(await inside.innerText()).includes(plan.criteria.title)) {
    await setEditorContent(inside, criteriaMarkup(plan));
    await inside.getByText(plan.criteria.title, { exact: true }).waitFor({ timeout });
  }
  await editor.focus();
  return pollClipboard(page, editor, blocks => blocks.synced.find(block => block.id), 'Создание синкблока');
}

async function inspect(page, key, plan, expectedSync) {
  const editor = articleEditor(page);
  await editor.waitFor({ timeout });
  const html = await copyEditor(editor);
  const expected = plan.pages[key];
  const syncText = plan.criteria.title;
  const syncedText = await editor.locator('.synced-content').allTextContents();
  const googleDoc = key === 'documents' && expected.example.kind === 'google-docs'
    ? await editor.evaluate((element, url) => element.editor?.getJSON().content?.some(item =>
      item.type === 'remote_docs' && item.attrs?.src === url) ?? false, expected.example.url)
    : false;
  const checks = await page.evaluate(({ source, key, expected, syncText, syncedText, expectedSync, googleDoc, headingColors, headingFont }) => {
    const body = new DOMParser().parseFromString(source, 'text/html').body;
    const node = kind => `[data-node-type="${kind}"]`;
    const count = selector => body.querySelectorAll(selector).length;
    const matches = (selector, total = 1) => count(selector) === total;
    const top = [...body.children];
    const childNodes = selector => top.filter(el => el.matches(selector));
    const check = {};
    if (key === 'main') {
      const hero = childNodes('[data-layout-section]')[0];
      const layout = hero?.querySelectorAll('[data-layout-column]');
      const headings = childNodes('h2').map(el => el.textContent.trim());
      check.firstScreen = Boolean(layout?.length === 2 && layout[0].querySelector(node('media')) &&
        layout[1].querySelector(node('table-of-contents')));
      check.sections = ['Подготовка', 'Контрольные точки', 'Разбор примера'].every((heading, i) => headings[i] === heading);
      check.preparation = matches(node('panel')) && matches(`${node('columns')} ${node('column')}`, 2) &&
        matches('[data-type="todo_item"]', expected.checklist.length) && Boolean(count('ul.bullet-list'));
      check.table = matches('hr') && matches('table');
      const disclosures = childNodes(node('expand'));
      check.disclosures = disclosures.length === expected.disclosures.length;
      if (expected.disclosures.some(item => item.comparison)) {
        check.comparisons = expected.disclosures.every(({ title, comparison }, index) => {
          if (!comparison) return true;
          const block = disclosures[index];
          if (block?.querySelector(node('expand-title'))?.textContent.trim() !== title.trim()) return false;
          const content = block.querySelector(node('expand-content'));
          const layouts = content?.querySelectorAll(':scope > [data-layout-section]');
          if (layouts?.length !== 1 || content.querySelector(node('media'))) return false;
          const columns = layouts[0].querySelectorAll(':scope > [data-layout-column]');
          return columns.length === comparison.length && comparison.every((card, column) => {
            const entry = columns[column];
            if (Math.abs(Number(entry.getAttribute('data-column-width')) - 100 / comparison.length) > 0.1) return false;
            const panels = entry.querySelectorAll(node('panel'));
            const [panel] = panels;
            if (panels.length !== 1 || panel.getAttribute('data-type') !== card.tone) return false;
            const [heading, thesis] = panel.children;
            const color = document.createElement('span');
            color.style.color = headingColors[card.tone];
            const titleMark = heading?.querySelector('strong span.text-color');
            const font = titleMark?.closest('span[style*="font-family"]')?.style;
            const family = font?.fontFamily.split(',')[0].trim().replace(/['"]/g, '');
            return titleMark?.textContent.trim() === card.title.trim() && titleMark.style.color === color.style.color &&
              family === headingFont.family && Number(font?.fontWeight) === headingFont.weight &&
              thesis?.textContent.trim() === card.text.trim();
          });
        });
      } else {
        check.disclosures &&= Boolean(body.querySelector(`${node('expand-content')} ${node('media')}`));
      }
      check.video = matches(`${node('media')}[data-mimetype^="video/"]`);
    }
    if (key === 'process') {
      const selector = `${node('code-block')}[language="mermaid"]`;
      check.mermaid = matches(selector) &&
        body.querySelector(selector)?.querySelector(node('code-editor'))?.textContent.trim() === expected.process.mermaid.trim();
      if (expected.process.outcome) {
        const blocks = top.filter(element => element.textContent.trim() || element.matches('hr'));
        const index = blocks.findIndex(element => element.matches(selector));
        const value = offset => blocks[index + offset]?.textContent.trim();
        check.mermaidLayout = Boolean(index >= 2 && blocks[index - 2]?.matches('h2') &&
          value(-2) === expected.process.title && value(-1) === expected.process.text.trim() &&
          blocks[index + 1]?.matches(node('panel')) && value(1).includes(expected.process.note.text.trim()) &&
          value(2) === 'Ожидаемый результат' && value(3) === expected.process.outcome.trim() &&
          blocks[index + 4]?.matches('hr'));
      }
      check.drawio = matches(`${node('remote_diagram')}[data-src^="https://viewer.diagrams.net/"]`);
      check.notes = matches(node('panel'), 2) && matches('hr');
    }
    if (key === 'documents') {
      const rows = childNodes(node('columns'));
      check.files = rows[0]?.querySelectorAll(`${node('media')}[data-mimetype="application/pdf"]`).length === 4;
      check.illustrations = rows[1]?.querySelectorAll(`${node('media')}[data-mimetype^="image/"]`).length === 4;
      check.example = expected.example.kind === 'teamly' ? matches('table') : googleDoc;
    }
    if (key === 'map') {
      check.iframe = body.querySelector(node('remote-iframe-content'))?.getAttribute('data-src') === expected.widget.url;
      check.original = [...body.querySelectorAll('a')].some(link => link.href === expected.original.url);
      check.note = matches(node('panel'));
    }
    const sync = body.querySelector(node('syncedContent'));
    const syncId = sync?.getAttribute('data-content-id');
    if (key === 'main' || key === 'documents') {
      check.synced = Boolean(syncId && (!expectedSync || syncId === expectedSync) &&
        (sync.getAttribute('data-content')?.includes(syncText) || syncedText.some(text => text.includes(syncText))));
    }
    return { checks: check, syncId: syncId ?? null, topLevelBlocks: top.length };
  }, { source: html, key, expected, syncText, syncedText, expectedSync, googleDoc,
    headingColors: comparisonHeadingColors, headingFont: comparisonHeadingFont });
  return checks;
}

async function inspectMermaidViewer(page, expected) {
  const preview = articleEditor(page).locator('.code-block-mermaid__content').first();
  await preview.scrollIntoViewIfNeeded({ timeout });
  const svg = preview.locator('svg.flowchart').filter({ has: page.locator('g.node') }).first();
  await svg.waitFor({ timeout });
  const result = await svg.evaluate(element => {
    const clusters = [...element.querySelectorAll('g.cluster')];
    const colors = clusters.map(cluster => {
      const rect = cluster.querySelector('rect');
      if (!rect) return {};
      const { fill, stroke } = getComputedStyle(rect);
      return { fill, stroke };
    });
    return {
      nodes: element.querySelectorAll('g.node').length,
      links: element.querySelectorAll('path.flowchart-link').length,
      clusters: clusters.length,
      colored: colors.every(({ fill, stroke }) => fill && fill !== 'none' && stroke && stroke !== 'none') &&
        new Set(colors.map(({ fill }) => fill)).size === clusters.length &&
        new Set(colors.map(({ stroke }) => stroke)).size === clusters.length,
    };
  });
  requireValue(result.nodes && result.links, 'Mermaid не отрисовал этапы и связи процесса.');
  if (expected) {
    requireValue(result.nodes === expected.nodes && result.clusters === expected.clusters && result.colored,
      'В Mermaid не подтвердились все этапы или отдельные цвета участников.');
  }
  return result;
}

function sameDiagram(actual, { orgChart, diagramSource }) {
  if (actual === orgChart) return true;
  const fragment = new URL(actual).hash;
  if (!fragment.startsWith('#R')) return false;
  try {
    const payload = Buffer.from(decodeURIComponent(fragment.slice(2)), 'base64');
    const text = inflateRawSync(payload, { maxOutputLength: Buffer.byteLength(encodeURIComponent(diagramSource)) });
    return decodeURIComponent(text.toString('utf8')) === diagramSource;
  } catch {
    return false;
  }
}

async function inspectDrawioViewer(page, settings) {
  const expectedPhotos = settings.diagramInfo?.cards;
  const iframe = articleEditor(page).locator(`iframe[src^="${drawioViewer}"]`).first();
  await iframe.scrollIntoViewIfNeeded({ timeout });
  requireValue(sameDiagram(await iframe.getAttribute('src'), settings), 'В Teamly открылась другая диаграмма draw.io.');
  const frame = await (await iframe.elementHandle()).contentFrame();
  requireValue(frame, 'Встроенный просмотрщик draw.io не открылся.');
  await frame.waitForFunction(() => [...document.querySelectorAll('svg')].some(svg => {
    const box = svg.getBoundingClientRect();
    return box.width > 20 && box.height > 20 && svg.querySelectorAll('g').length > 4;
  }), undefined, { timeout });
  if (expectedPhotos) {
    await frame.waitForFunction(count => document.querySelectorAll('svg image').length >= count,
      expectedPhotos, { timeout });
    const loaded = await frame.evaluate(async () => {
      const pictures = [...document.querySelectorAll('svg image')];
      const sources = pictures.map(image => image.getAttribute('href') ?? image.getAttribute('xlink:href'))
        .filter(source => source?.startsWith('data:image/'));
      await Promise.all([...new Set(sources)].map(async source => {
        const image = new Image();
        image.src = source;
        await image.decode();
      }));
      return sources.length;
    });
    requireValue(loaded >= expectedPhotos, `В просмотрщике загрузилось ${loaded} из ${expectedPhotos} фотографий.`);
  }
}

async function createArticle(page, { space, beforeCreate }) {
  await goto(page, space.href);
  const globalCreate = page.getByRole('button', { name: 'Создать', exact: true });
  requireValue(await waitForAny([globalCreate.first()]),
    `Для записи войдите в Teamly в профиле Playwright на ${space.origin}/auth/sign-in.`);
  const previous = new URL(page.url()).pathname;
  await globalCreate.first().click();
  const create = page.getByText('Новая статья', { exact: true }).filter({ visible: true }).last();
  await create.waitFor({ timeout });
  await beforeCreate();
  await create.click();
  await page.waitForURL(url => url.origin === space.origin && articlePath.test(url.pathname) && url.pathname !== previous,
    { timeout: 25_000 });
  return new URL(page.url()).origin + new URL(page.url()).pathname;
}

async function titleField(page) {
  const selector = [
    '[data-test-id="article-title"][contenteditable="plaintext-only"]',
    '.editor__title [contenteditable="true"]',
    '[contenteditable="true"][data-placeholder*="назв" i]',
    '[contenteditable="true"][data-placeholder*="заголов" i]',
    'h1[contenteditable="true"], h1 [contenteditable="true"]',
    'input[placeholder*="назв" i]',
    '[class*="article-title"] [contenteditable="true"]',
    '[class*="article-name"] [contenteditable="true"]',
    '.tiptap[contenteditable="true"]:not(.tiptap .tiptap):not([role="textbox"])',
  ].join(',');
  const direct = page.locator(selector).filter({ visible: true }).first();
  if (await waitForAny([direct], 2500)) return direct;
  const editor = articleEditor(page, true);
  const before = page.locator('[contenteditable="true"]:not(.tiptap *)').filter({ visible: true });
  const candidates = await before.evaluateAll((nodes, selector) => {
    const body = document.querySelector(selector);
    return nodes.flatMap((node, index) => node !== body && body &&
      node.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING ? [index] : []);
  }, editorSelector + '[contenteditable="true"]');
  requireValue(candidates.length === 1 && await editor.count() === 1, 'Поле заголовка Teamly не определилось однозначно.');
  return before.nth(candidates[0]);
}

async function assertEditable(page, space) {
  const create = page.getByRole('button', { name: 'Создать', exact: true }).first();
  requireValue(await waitForAny([create], 6500),
    `Редактор недоступен. Войдите в Teamly в профиле Playwright на ${space.origin}/auth/sign-in и проверьте права пространства.`);
}

function treeRow(page, url) {
  const { pathname } = new URL(url);
  return page.locator(`a.tree-item__link[href="${url}"], a.tree-item__link[href="${pathname}"]`).first();
}

async function isNested(page, parent) {
  const row = treeRow(page, parent);
  await row.waitFor({ timeout });
  const parentTitle = (await row.locator('xpath=..').locator('.tree-item__content').innerText()).trim();
  const crumbs = await page.locator('.breadcrumbs__item-link').allInnerTexts();
  return crumbs.at(-2)?.replace(/\s*\/\s*$/u, '').trim() === parentTitle;
}

async function dragRow(page, source, destination) {
  const handle = treeRow(page, source).locator('xpath=..').locator('svg:has(use[href="#icon-drag"])').first();
  if (!await handle.isVisible()) {
    await page.getByRole('button', { name: 'Переместить', exact: true }).first().click();
  }
  const target = treeRow(page, destination).locator('xpath=ancestor::div[contains(@class,"drag-tree-node__content")][1]');
  await target.waitFor({ timeout });
  requireValue(!(await target.getAttribute('class')).includes('cannot-drop'), 'В дереве Teamly отключено перемещение под выбранную статью.');
  await handle.dragTo(target, { timeout: 15_000 });
}

async function moveUnder(page, source, parent) {
  if (await isNested(page, parent)) return;
  await dragRow(page, source, parent);
  const limit = Date.now() + 8000;
  do {
    if (await isNested(page, parent)) return;
    await page.waitForTimeout(350);
  } while (Date.now() < limit);
  throw new Error('После переноса родительская статья не появилась в пути страницы.');
}

async function verifyChildOrder(page, urls) {
  await goto(page, urls.at(-1));
  await Promise.all(urls.map(url => treeRow(page, url).waitFor({ timeout })));
  const actual = await page.locator('a.tree-item__link').evaluateAll((links, expected) =>
    links.map(link => link.href).filter(url => expected.includes(url)), urls);
  return actual.length === urls.length && actual.every((url, index) => url === urls[index]);
}

async function canPlaceUnder(page, url) {
  await goto(page, url);
  const row = treeRow(page, url);
  await row.waitFor({ timeout });
  return row.evaluate(element => !element.closest('.drag-tree-node__content.cannot-drop'));
}

async function publish(page, url) {
  const button = page.getByRole('button', { name: 'Опубликовать', exact: true }).first();
  await button.click();
  const draftIcon = treeRow(page, url).locator('xpath=..').locator('.tree-item__content use[href="#icon-draft"]');
  await draftIcon.waitFor({ state: 'detached', timeout: 15000 });
  await button.waitFor({ state: 'hidden', timeout: 15000 });
}

async function build(page, settings, statePath, state, publishMain) {
  const { plan, space, local, orgChart } = settings;
  const record = async () => {
    const temporary = `${statePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, json(state), { mode: 0o600 });
    await rename(temporary, statePath);
  };
  await goto(page, plan.parent ?? space.href);
  await assertEditable(page, space);
  const resultsByKey = {};
  const placement = new Map();
  for (const key of creationOrder) {
    const expected = plan.pages[key];
    const parent = key === 'main' ? plan.parent : state.pages.main?.url;
    const item = state.pages[key] ?? {};
    try {
      requireValue(key === 'main' || parent, 'Нужна ссылка на созданную главную статью.');
      if (parent && !placement.has(parent)) placement.set(parent, await canPlaceUnder(page, parent));
      if (item.status === 'creating' && !item.url) {
        throw new Error('Создание прервалось до сохранения ссылки. Уточните в дереве, появился ли черновик, прежде чем возобновлять сборку.');
      }
      if (!item.url) {
        state.pages[key] = item;
        item.parent = null;
        item.url = await createArticle(page, { space, beforeCreate: async () => {
          item.status = 'creating';
          await record();
        } });
        item.status = 'created';
        await record();
      } else {
        await goto(page, item.url);
      }
      const editor = articleEditor(page, true);
      await editor.waitFor({ timeout });
      const title = await titleField(page);
      if (item.status === 'created') {
        await title.fill(expected.title);
        await editor.focus();
        item.status = 'staging';
        await record();
      }
      if (item.status === 'staging') {
        const existing = await clipboardBlocks(page, await copyEditor(editor));
        const uploaded = await uploadedMedia(editor);
        const media = item.media ??= {};
        for (const file of articleFiles(plan, key)) {
          if (media[file]) continue;
          media[file] = uploaded[basename(file).normalize()] ?? await upload(page, editor, local(file));
          await record();
        }
        if (key === 'main') {
          state.sync = existing.synced.find(block => block.id) ?? state.sync ?? await createSync(page, editor, plan);
          await record();
        }
        requireValue(!['main', 'documents'].includes(key) || state.sync?.id, 'Сначала создайте синкблок в главной статье.');
        let synced = state.sync?.html ?? '';
        if (key === 'documents') {
          // A linked copy needs a distinct node ID and the same shared content ID.
          synced = synced.replace(/\bdata-id="[^"]*"/u, `data-id="${randomUUID()}"`);
        }
        await setEditorContent(editor, articleMarkup(plan, key, media, { synced }), trailingWidget(plan, key, orgChart));
        const opening = typeof expected.intro === 'string' ? expected.intro : expected.intro.text;
        if (!await waitForAny([editor.getByText(opening, { exact: true })])) {
          const structure = await editor.locator(':scope > *').evaluateAll(nodes => nodes.map(node =>
            node.getAttribute('data-node-type') || node.className || node.tagName));
          throw new Error(`Редактор не принял макет. Сохранённые типы блоков: ${structure.join(', ')}.`);
        }
        if (key === 'main' || key === 'documents') {
          await editor.locator('.synced-content').getByText(plan.criteria.title, { exact: true }).waitFor({ timeout });
        }
        const immediate = await inspect(page, key, plan, state.sync?.id);
        const missing = Object.entries(immediate.checks).filter(([, ok]) => !ok).map(([name]) => name);
        requireValue(missing.length === 0, `Не появились блоки после вставки: ${missing.join(', ')}.`);
        item.status = 'assembled';
        await record();
      }
      const draft = page.getByRole('button', { name: /^(Сохранить черновик|В черновики)$/iu }).first();
      if (await draft.isVisible()) await draft.click();
      let checked = await confirmSaved(page, key, plan, state.sync?.id, item.url);
      if (key === 'main' && publishMain && checked.status === 'draft') {
        await publish(page, item.url);
        checked = await confirmSaved(page, key, plan, state.sync?.id, item.url, 'published');
      }
      if (parent && placement.get(parent)) {
        if (!await isNested(page, parent)) await moveUnder(page, item.url, parent);
        checked = await confirmSaved(page, key, plan, state.sync?.id, item.url, checked.status, parent);
        item.parent = parent;
      }
      item.status = 'verified';
      await record();
      if (parent) checked.checks.nested = item.parent === parent && await isNested(page, parent);
      const pendingPlacement = checked.checks.nested === false ?
        'Teamly отключил размещение под выбранной родительской статьёй.' : undefined;
      resultsByKey[key] = { title: expected.title, url: item.url, ...checked, placement: pendingPlacement };
      if (key === 'process') {
        const result = resultsByKey[key];
        try {
          result.mermaid = await inspectMermaidViewer(page, settings.processDiagram);
          result.checks.mermaidRendered = true;
        } catch (error) {
          result.checks.mermaidRendered = false;
          result.mermaidError = error.message;
        }
        try {
          await inspectDrawioViewer(page, settings);
          result.checks.drawioRendered = true;
          result.drawioPublication = checked.status === 'published' ? 'verified' : 'pending';
        } catch (error) {
          result.checks.drawioRendered = false;
          result.drawioError = error.message;
        }
      }
    } catch (error) {
      resultsByKey[key] = { title: expected.title, url: item.url, status: item.status, error: error.message };
    }
  }
  const results = order.map(key => resultsByKey[key]);
  const children = results.slice(1);
  if (children.length === 3 && children.every(result => result.checks?.nested)) {
    try {
      results[0].checks.childOrder = await verifyChildOrder(page, children.map(result => result.url));
      if (!results[0].checks.childOrder) {
        results[0].placement = 'Порядок существующих черновиков в дереве отличается от плана.';
      }
    } catch (error) {
      results[0].checks.childOrder = false;
      results[0].placement = error.message;
    }
  }
  return results;
}

async function confirmSaved(page, key, plan, sync, url, expectedStatus, parent) {
  // Teamly can persist edits asynchronously. Read the saved page again until its structure matches.
  const limit = Date.now() + 25_000;
  let check;
  do {
    await page.waitForTimeout(800);
    await goto(page, url);
    const field = page.locator('.editor-title__text');
    const title = await waitForAny([field.filter({ hasText: plan.pages[key].title })], 4000);
    const row = treeRow(page, url);
    await row.waitFor({ timeout });
    const isDraft = await row.locator('xpath=..').locator('.tree-item__content use[href="#icon-draft"]').count() === 1;
    if (key === 'main' || key === 'documents') {
      await waitForAny([articleEditor(page).locator('.synced-content')
        .getByText(plan.criteria.title, { exact: true })], 4500);
    }
    check = await inspect(page, key, plan, sync);
    check.status = isDraft ? 'draft' : 'published';
    check.checks.title = Boolean(title && (await field.innerText()).trim() === plan.pages[key].title);
    if (expectedStatus) check.checks.visibility = check.status === expectedStatus;
    if (parent) check.checks.nested = await isNested(page, parent);
    if (Object.values(check.checks).every(Boolean)) return check;
  } while (Date.now() < limit);
  const missing = Object.entries(check.checks).filter(([, ok]) => !ok).map(([name]) => name);
  throw new Error(`После открытия сохранённой страницы не подтвердились: ${missing.join(', ')}.`);
}

async function verifyExisting(page, { plan, space }) {
  const results = [];
  let sync;
  for (const key of order) {
    const url = httpsUrl(plan.baseline?.[key]);
    requireValue(url.origin === space.origin && articlePath.test(url.pathname), 'Неверная ссылка на исходную статью.');
    await goto(page, url.href);
    const check = await inspect(page, key, plan, sync);
    if (key === 'main') sync = check.syncId;
    if (key !== 'main') {
      check.checks.nested = await isNested(page, plan.baseline.main);
    }
    const title = await page.locator('.editor-title__text').textContent();
    results.push({ title: title.trim(), url: url.href, ...check });
  }
  return results;
}

async function verifyPublishedDrawio(page, settings, url) {
  await goto(page, url.href);
  const row = treeRow(page, url.href);
  await row.waitFor({ timeout });
  const isDraft = await row.locator('xpath=..').locator('.tree-item__content use[href="#icon-draft"]').count() > 0;
  requireValue(!isDraft && !await page.getByRole('button', { name: 'Опубликовать', exact: true }).first().isVisible(),
    'Страница с диаграммой находится в черновиках.');
  await inspectDrawioViewer(page, settings);
  return { ok: true, url: url.href, drawioPublication: 'verified' };
}

async function verifySavedMermaid(page, settings, url) {
  await goto(page, url.href);
  const { checks } = await inspect(page, 'process', settings.plan);
  requireValue(checks.mermaid, 'Сохранённый код Mermaid отличается от плана.');
  requireValue(checks.mermaidLayout !== false, 'Сохранённые блоки Mermaid расположены не по плану.');
  const mermaid = await inspectMermaidViewer(page, settings.processDiagram);
  return { ok: true, url: url.href, mermaid };
}

async function run() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      profile: { type: 'string' }, state: { type: 'string' }, headless: { type: 'boolean' },
      'publish-main': { type: 'boolean' }, article: { type: 'string' },
    },
  });
  const [command, planPath] = positionals;
  const articleChecks = ['verify-drawio', 'verify-mermaid'];
  requireValue(['check', 'sign-in', 'build', 'verify-existing', ...articleChecks].includes(command) && planPath,
    'Запуск: node teamly-browser.mjs <check|sign-in|build|verify-existing|verify-drawio|verify-mermaid> <план.json> [--profile каталог] [--state файл] [--headless] [--publish-main] [--article ссылка]');
  requireValue(!values['publish-main'] || command === 'build', 'Параметр --publish-main применим к команде build.');
  requireValue(Boolean(values.article) === articleChecks.includes(command), 'Для проверки диаграммы укажите --article со ссылкой на страницу Teamly.');
  const file = resolve(planPath);
  const readOnly = ['verify-existing', ...articleChecks].includes(command);
  const settings = await readPlan(file, { allowLegacyComparison: readOnly || command === 'sign-in' });
  if (command === 'check') {
    const { processDiagram } = settings;
    return { ok: true, drawio: settings.diagramInfo,
      mermaid: processDiagram && { clusters: processDiagram.clusters, nodes: processDiagram.nodes },
      pages: order.map(key => ({ title: settings.plan.pages[key].title, files: articleFiles(settings.plan, key).length })) };
  }
  const { chromium } = await import('playwright');
  const { space, fingerprint } = settings;
  const statePath = resolve(values.state ?? `${file}.state.json`);
  const profile = values.profile && resolve(values.profile);
  requireValue(readOnly || profile, 'Укажите отдельный профиль Chrome через --profile.');
  const article = values.article ? httpsUrl(values.article) : null;
  requireValue(!article || (article.origin === space.origin && articlePath.test(article.pathname)), 'Неверная ссылка на статью Teamly.');
  const state = { fingerprint, pages: {} };
  let lock;
  let context;
  try {
    if (command === 'build') {
      await mkdir(dirname(statePath), { recursive: true });
      lock = await open(`${statePath}.lock`, 'wx', 0o600);
      try {
        Object.assign(state, JSON.parse(await readFile(statePath, 'utf8')));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      requireValue(state.fingerprint === fingerprint, 'План изменился. Для отдельной сборки укажите новый файл состояния.');
      for (const [key, item] of Object.entries(state.pages)) {
        const url = item.url && httpsUrl(item.url);
        requireValue(order.includes(key) && (!url || url.origin === space.origin && articlePath.test(url.pathname)),
          'Файл состояния содержит неожиданную ссылку на статью.');
      }
    }
    if (profile) await mkdir(profile, { mode: 0o700, recursive: true });
    context = await chromium.launchPersistentContext(profile ?? '', {
      channel: 'chrome', headless: readOnly || Boolean(values.headless),
      viewport: { width: 1500, height: 1000 }, timeout: 20_000,
    });
    context.setDefaultTimeout(timeout);
    const page = context.pages()[0] ?? await context.newPage();
    if (command === 'verify-mermaid') {
      await context.route(`${drawioViewer}**`, route => route.abort());
      return await verifySavedMermaid(page, settings, article);
    }
    if (command === 'verify-drawio') return await verifyPublishedDrawio(page, settings, article);
    if (command === 'sign-in') {
      await goto(page, `${space.origin}/auth/sign-in`);
      if (new URL(page.url()).pathname.startsWith('/auth/')) {
        await page.waitForURL(url => url.origin === space.origin && !url.pathname.startsWith('/auth/'),
          { timeout: 300_000 });
      }
      await goto(page, space.href);
      await assertEditable(page, space);
      return { ok: true, origin: space.origin };
    }
    const results = command === 'build' ? await build(page, settings, statePath, state, values['publish-main']) :
      await verifyExisting(page, settings);
    return { ok: results.every(result => result.checks && Object.values(result.checks).every(Boolean)), pages: results };
  } catch (error) {
    const pages = Object.fromEntries(Object.entries(state.pages).map(([key, item]) => [key, {
      status: item.status, url: item.url,
    }]));
    return { ok: false, error: error.message, pages };
  } finally {
    await context?.close();
    if (lock) {
      await lock.close();
      await unlink(`${statePath}.lock`);
    }
  }
}

export { articleEditor, setEditorContent, upload, uploadedMedia };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await run();
    process.stdout.write(json(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(json({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
