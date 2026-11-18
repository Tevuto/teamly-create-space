import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { withJournal } from './teamly-superarticle/scripts/code-mode/journal.mjs';
import { sales } from './teamly-sales-profile.mjs';
import { learning } from './teamly-learning-profile.mjs';
import { readSuperarticlePlan, runSuperarticle, superarticleLayout } from './teamly-superarticle/scripts/reference-layout.mjs';
import { childArticleLayout, readChildArticles, runChildArticles } from './teamly-superarticle/scripts/child-layouts.mjs';
import { missingGlossaryTerms, readSpaceContent, spaceContentHandlers } from './teamly-superarticle/scripts/space-content.mjs';
import { bindWorkArticles, readWorkArticles, runWorkArticleBatch, workArticle, workArticleHandlers } from './teamly-superarticle/scripts/work-articles.mjs';
import { bindSmartTables, readSmartTables, runSmartTableAdvanced, runSmartTableData, runSmartTables, smartTableSession } from './teamly-superarticle/scripts/smart-tables.mjs';
import { bindCourse, courseMaterial, courseTest, readCourse, runCourse } from './teamly-superarticle/scripts/course.mjs';
import { demoReport, duration, prepareDemo, timingSummary } from './teamly-superarticle/scripts/demo-report.mjs';
import { rootCoverArt } from './teamly-cover-layout.mjs';

const moduleIds = { 'Глоссарий': 'glossary', 'Быстрые ссылки': 'fastLinks', 'Связанный диск': 'disk', 'Свойства': 'property' };
const articlePositions = {
  ROOT: [null, '🏠', 'дом', 'house'],
  SUPER: ['ROOT', '⭐', 'звезда', 'star'],
  'SUPER-1': ['SUPER', '📋', 'планшет', 'clipboard'],
  'SUPER-2': ['SUPER', '🔍', 'лупа', 'magnifying glass'],
  'SUPER-3': ['SUPER', '📈', 'диаграмма роста', 'chart increasing'],
  'SEC-01': ['ROOT', '🎯', 'дартс', 'direct hit'],
  'SEC-01-1': ['SEC-01', '📝', 'заметка', 'memo'],
  'SEC-01-2': ['SEC-01', '📌', 'кнопка', 'pushpin'],
  'SEC-01-3': ['SEC-01', '✅', 'галочка', 'check mark button'],
  'SEC-02': ['ROOT', '📚', 'книги', 'books'],
  'SEC-02-1': ['SEC-02', '📖', 'открытая книга', 'open book'],
  'SEC-02-2': ['SEC-02', '📎', 'скрепка', 'paperclip'],
  'SEC-02-3': ['SEC-02', '💡', 'лампочка', 'light bulb'],
  'SEC-03': ['ROOT', '🔧', 'гаечный ключ', 'wrench'],
  'SEC-03-1': ['SEC-03', '📁', 'папка', 'file folder'],
  'SEC-03-2': ['SEC-03', '📅', 'календарь', 'calendar'],
  'SEC-03-3': ['SEC-03', '🔔', 'колокольчик', 'bell'],
  'SEC-04': ['ROOT', '🧭', 'компас', 'compass'],
  'SEC-04-1': ['SEC-04', '💬', 'облачко с многоточием', 'speech balloon'],
  'SEC-04-2': ['SEC-04', '🔑', 'ключ', 'key'],
  'SEC-04-3': ['SEC-04', '🏆', 'кубок', 'trophy'],
  'SEC-05': ['ROOT', '📊', 'гистограмма', 'bar chart'],
};

// preview проходит мастер до подтверждения. apply создаёт пространство с нуля.
// --rights принимает JSON-массив {type, name, level, match?}; type: user, department, group.
export const production = {
  host: 'https://sdemo.teamly.ru',
  title: 'Производство',
  description: 'Стандарты смены, качество, обслуживание оборудования и безопасность производства.',
  pages: [
    {
      key: 'ROOT', title: 'Производство', emoji: '🏭', emojiName: 'factory',
      text: 'Рабочее пространство производственной команды. Мастера смен, операторы и инженеры найдут здесь материалы по организации смены, качеству, оборудованию и безопасности.',
      icon: 'M17 79V44l24-13v17l24-14v14l18-9v40ZM72 44V21h10v19M28 60h8m9 0h8m9 0h8',
    },
    {
      key: 'SEC-01', title: 'Производственные стандарты', emoji: '📋', emojiName: 'clipboard',
      text: 'Материалы мастера смены и оператора по запуску работ, передаче смены и фиксации отклонений. Здесь собраны правила ведения сменных записей и распределения ответственности.',
      icon: 'M35 26H25v56h50V26H65M39 21h22v13H39ZM36 49l4 4 7-8m5 5h13M36 65l4 4 7-8m5 5h13',
    },
    {
      key: 'SEC-02', title: 'Контроль качества', emoji: '🔍', emojiName: 'magnifying glass',
      text: 'Контрольные точки процесса, критерии приёмки и порядок регистрации несоответствий. Раздел помогает проследить путь от проверки партии до решения по отклонению.',
      icon: 'M65 61l17 17M71 45a22 22 0 1 1-44 0 22 22 0 1 1 44 0ZM40 46l6 6 12-13',
    },
    {
      key: 'SEC-03', title: 'Обслуживание оборудования', emoji: '🔧', emojiName: 'wrench',
      text: 'Плановые осмотры, заявки на обслуживание и передача информации ремонтной команде. Здесь можно найти порядок регистрации простоев и сведения для подготовки работ.',
      icon: 'M66 21l-9 12 5 10 11 1 9-11c2 15-8 25-21 24L37 81a9 9 0 0 1-13-13l25-24c-1-13 6-21 17-23Z',
    },
    {
      key: 'SEC-04', title: 'Безопасность производства', emoji: '🛡️', emojiName: 'shield',
      text: 'Навигация по материалам инструктажей и перечням проверок на рабочем месте. Для инструкций и допусков используйте действующие документы своего участка.',
      icon: 'M50 19l27 10v19c0 14-10 25-27 33-17-8-27-19-27-33V29ZM38 49l8 8 17-17',
    },
    {
      key: 'SEC-05', title: 'Примеры использования ТБД', emoji: '📊', emojiName: 'bar chart',
      text: 'Раздел для примеров умных таблиц производства. Здесь будут доступны реестры сменных задач, отклонений качества, заявок на ремонт, осмотров и инструктажей.',
      icon: 'M22 76h57M28 76V52h10v24m7 0V39h10v37m8 0V25h10v51',
    },
  ],
  rights: [],
};

export function needsCover({ key, parent, kind }) {
  return kind !== 'database' && (key === 'ROOT' ||
    (parent ?? 'ROOT') === 'ROOT' || parent === 'SUPER');
}

export async function runSpacePilot(page, plan, {
  apply = false, state = { objects: {}, steps: {} }, save = async () => {}, stopAfter, resumeVerification = false,
  content, articles, tables, course,
} = {}) {
  const timeout = { timeout: 12000 };
  const sidebarTimeout = { timeout: 2500 };
  const { origin } = new URL(plan.host);
  const route = /^\/(at|sp|db)\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/?$/iu;
  const tree = page.locator('.article-content-tree:visible');
  const title = page.locator('.editor-title__text[data-test-id="article-title"]');
  const body = page.locator('.editor__editor > .tiptap.ProseMirror');
  const publish = page.getByRole('button', { name: 'Опубликовать', exact: true });
  const draftIcon = 'use[href="#icon-draft"]';
  const nav = body.locator('[class*="nested-articles"], [data-node-type*="nested" i]').first();
  const covers = new Map();
  const started = Date.now();
  const timings = { articles: {}, verification: {} };
  let stage;
  let verifying;
  let reopened = 0;
  state.steps ??= {};

  function checksPassed(checks) {
    return Boolean(checks && Object.keys(checks).length && Object.values(checks).every(Boolean));
  }

  function requireValue(condition, message) {
    if (!condition) throw new Error(message);
  }

  function urlOf(href, kind = 'at') {
    const url = new URL(href);
    requireValue(url.origin === origin && route.exec(url.pathname)?.[1] === kind, 'Неверный адрес Teamly: ' + url.pathname);
    return url.origin + url.pathname.replace(/\/$/u, '');
  }

  function button(name, scope = page) {
    return scope.getByRole('button', { name, exact: true }).filter({ visible: true });
  }

  function test(id) {
    return page.locator('[data-test-id="' + id + '"]').filter({ visible: true });
  }

  function visibleRows(url) {
    const path = new URL(url).pathname;
    const hrefs = [url, path];
    return tree.locator('.tree-item:visible').filter({
      has: page.locator(hrefs.map(href => 'a.tree-item__link[href=' + JSON.stringify(href) + ']').join(',')),
    });
  }

  function row(url) {
    return visibleRows(url).first();
  }

  async function sidebarTitle(url, expected, options = timeout) {
    const label = visibleRows(url).locator('.tree-item__text:visible').and(page.getByText(expected, { exact: true }));
    await label.first().waitFor(options);
  }

  async function children(parent, options = timeout) {
    const item = row(parent);
    await item.waitFor(options);
    const expand = item.locator('button.tree-item__expand-button:not(.expanded)');
    if (await expand.isVisible()) {
      await expand.click(options);
      await expand.waitFor({ ...options, state: 'hidden' });
    }
    await tree.locator('[aria-busy="true"]:visible, .is-loading:visible').waitFor({ ...options, state: 'hidden' });
    return item.evaluate((root, isRoot) => {
      const node = root.closest('.drag-tree-node');
      const depth = Number.parseFloat(node.style.paddingLeft);
      const firstRow = [...node.parentElement.children].find(child => child.matches('.drag-tree-node'));
      if (!Number.isFinite(depth) || !node.parentElement.matches('.article-content-tree__content') ||
          (isRoot && (depth !== 0 || firstRow !== node))) {
        throw new Error('Боковая панель не подтвердила корневую статью пространства.');
      }
      const result = [];
      let childDepth = isRoot ? depth : undefined;
      for (let next = node.nextElementSibling; next?.matches('.drag-tree-node'); next = next.nextElementSibling) {
        const level = Number.parseFloat(next.style.paddingLeft);
        if (!isRoot && level <= depth) break;
        childDepth ??= level;
        if (level !== childDepth) continue;
        const link = next.querySelector('a.tree-item__link');
        result.push({
          title: next.querySelector('.tree-item__text')?.textContent.trim(),
          url: link && link.origin + link.pathname.replace(/\/$/u, ''),
          draft: Boolean(next.querySelector('use[href="#icon-draft"]')),
        });
      }
      return result;
    }, parent === state.objects.ROOT?.url);
  }

  async function placement(root, url, draft, name) {
    const found = (await children(root)).find(child => child.url === url);
    requireValue(found && found.draft === draft && (draft || !name || found.title === name),
      'Боковая панель не подтвердила раздел «' + name + '» под корневой.');
  }

  async function spacesNamed() {
    const list = origin + '/space/list/all';
    if (page.url() !== list) await page.goto(list, { ...timeout, waitUntil: 'domcontentloaded' });
    const search = page.getByRole('textbox', { name: 'Поиск по пространствам' });
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/wiki/ql/spaces' &&
        r.request().postData()?.includes(plan.title), timeout),
      (async () => { await search.fill(plan.title, timeout); await search.press('Enter', timeout); })(),
    ]);
    requireValue(response.ok(), 'Не удалось проверить совпадения в списке пространств.');
    await page.locator('.space-list-page .message, .space-list-page .root-entity-cards-item__title').first().waitFor(timeout);
    return page.locator('.root-entity-cards-item__title').and(page.getByText(plan.title, { exact: true }));
  }

  async function wizard() {
    const list = origin + '/space/list/all';
    if (plan.structureOnly) {
      requireValue(!await (await spacesNamed()).count(), 'Пространство «' + plan.title + '» уже существует.');
    } else if (page.url() !== list) {
      await page.goto(list, { ...timeout, waitUntil: 'domcontentloaded' });
    }
    const launch = page.locator('.space-list-page__action.create button:visible');
    await launch.waitFor(timeout);
    await launch.click(timeout);
    const name = test('create-space-popup-title');
    if (!await name.isVisible()) {
      await button('Создать пространство').click(timeout);
    }
    await name.fill(plan.title, timeout);
    await test('create-space-popup-description').fill(plan.description, timeout);
    const confirm = test('create-space-popup-confirm-button');
    await confirm.and(button('Продолжить')).click(timeout);
    await name.waitFor({ ...timeout, state: 'hidden' });
    const option = page.getByText('С нуля', { exact: true });
    await option.or(confirm.and(button('Продолжить'))).first().waitFor(timeout);
    const inputs = (plan.modules ?? []).map(module => page.locator(
      'input[data-test-id="space-settings-item"][data-element-id="' + moduleIds[module] + '"]',
    ));
    const selected = await Promise.all(inputs.map(input => input.isChecked(timeout)));
    for (const [index, input] of inputs.entries()) {
      if (!selected[index]) await page.locator('label').filter({ has: input }).click(timeout);
    }
    if (!await option.isVisible()) await confirm.and(button('Продолжить')).click(timeout);
    await option.waitFor(timeout);
    const card = page.locator('.space-template-item').filter({ has: option });
    const radio = card.locator('input[data-test-id="space-template-radio"]');
    if (!await radio.isChecked(timeout)) await card.locator('.space-template-item__radio-overlay').click(timeout);
    requireValue(await radio.isChecked(timeout), 'Шаблон «С нуля» не выбран.');
    const finish = confirm.and(button('Создать'));
    await finish.waitFor(timeout);
    return finish;
  }

  async function makeCovers(pages) {
    if (!pages.length) return;
    if (pages.every(item => item.coverFile)) {
      for (const item of pages) {
        covers.set(item.key, item.coverFile);
      }
      return;
    }
    const images = await page.evaluate(({ items, artwork }) => {
        const backdrop = document.createElement('canvas');
        backdrop.width = 2500;
        backdrop.height = 500;
        const ctx = backdrop.getContext('2d');
        const background = ctx.createLinearGradient(0, 500, 2400, 0);
        background.addColorStop(0, '#21104D');
        background.addColorStop(0.56, '#342373');
        background.addColorStop(1, '#21104D');
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, 2500, 500);
        for (const [x, y, color] of [[110, 580, '#6648F5'], [2240, -160, '#3984F6']]) {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, 990);
          glow.addColorStop(0, color + '66');
          glow.addColorStop(1, color + '00');
          ctx.fillStyle = glow;
          ctx.fillRect(0, 0, 2500, 500);
        }
        ctx.strokeStyle = '#B5ABFA24';
        ctx.lineWidth = 2;
        for (let offset = 0; offset < 5; offset += 1) {
          ctx.beginPath();
          ctx.ellipse(70, 545, 400 + offset * 110, 170 + offset * 42, -0.33, Math.PI, Math.PI * 2);
          ctx.ellipse(2460, -75, 415 + offset * 105, 170 + offset * 42, -0.28, 0, Math.PI);
          ctx.stroke();
        }
        const canvas = document.createElement('canvas');
        canvas.width = backdrop.width;
        canvas.height = backdrop.height;
        const art = canvas.getContext('2d');
        return items.map(({ key, icon }) => {
          art.save();
          art.drawImage(backdrop, 0, 0);
          const root = key === 'ROOT';
          const center = root ? 1699 : 1250;
          if (root) {
            art.fillStyle = '#F7F5FF';
            art.textAlign = 'center';
            art.textBaseline = 'middle';
            let size = 80;
            do art.font = 'bold ' + size + 'px system-ui';
            while (artwork.lines.some(line => art.measureText(line).width > 685) && --size > 42);
            artwork.lines.forEach((line, index) =>
              art.fillText(line, 1250, 250 + (index - (artwork.lines.length - 1) / 2) * size * 1.08, 685));
          }
          const tile = art.createLinearGradient(center - 105, 145, center + 105, 355);
          tile.addColorStop(0, '#7558F6');
          tile.addColorStop(1, '#4934AA');
          art.fillStyle = tile;
          const contour = root ? new Path2D(artwork.tile) : new Path2D();
          if (!root) contour.roundRect(center - 105, 145, 210, 210, 45);
          art.fill(contour);
          art.strokeStyle = '#AE9EFF';
          art.lineWidth = 3;
          art.stroke(contour);
          art.translate(center - 80, 170);
          art.scale(1.6, 1.6);
          art.strokeStyle = '#F7F5FF';
          art.lineWidth = 4;
          art.lineJoin = 'round';
          art.lineCap = 'round';
          art.stroke(new Path2D(icon));
          art.restore();
          return [key, canvas.toDataURL('image/png').split(',')[1]];
        });
      }, { items: pages, artwork: plan.rootCoverArt });
    for (const [key, base64] of images) {
      requireValue(base64.startsWith('iVBOR'), 'Не удалось подготовить PNG-обложку ' + key + '.');
      covers.set(key, { name: key + '.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
    }
  }

  async function expectResponse(path, action) {
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === path &&
        response.request().method() === 'POST', timeout),
      action(),
    ]);
    requireValue(response.ok(), 'Teamly вернул HTTP ' + response.status() + ' при сохранении.');
  }

  async function publishIfDraft(url) {
    const icon = row(url).locator(draftIcon);
    if (!await icon.count() && !await publish.isVisible()) return;
    await expectResponse('/api/v1/wiki/articles/' + new URL(url).pathname.split('/').at(-1) + '/publish',
      () => publish.click(timeout));
    await publish.waitFor({ ...timeout, state: 'hidden' });
    if (!plan.singlePass) await icon.waitFor({ ...timeout, state: 'detached' });
  }

  async function setTextAndNav(item, url) {
    await title.waitFor(timeout);
    const previous = (await title.innerText(timeout)).trim();
    requireValue(!previous || previous === item.title, 'Заголовок открытой статьи отличается от плана.');
    const saveContent = () => plan.structureOnly ? assertEmptyArticle() : setContentAndNav(item);
    const editing = previous ? saveContent() : expectResponse('/api/v1/wiki/properties/command/execute', async () => {
      await title.fill(item.title, timeout);
      await title.press('Tab', timeout);
      await saveContent();
    });
    if (plan.singlePass) await editing;
    else await Promise.all([editing, sidebarTitle(url, item.title)]);
  }

  async function assertEmptyArticle() {
    await body.waitFor({ ...timeout, state: 'attached' });
    requireValue(await body.evaluate(el => !el.textContent.trim() &&
      [...el.querySelectorAll('*')].every(child => child.matches('p,br'))), 'Тело новой статьи не пустое.');
  }

  async function setContentAndNav(item) {
    await body.waitFor({ ...timeout, state: 'attached' });
    const content = await body.evaluate((element, text) => {
      const empty = !element.textContent.trim() &&
        [...element.querySelectorAll('*')].every(child => child.matches('p,br'));
      if (!empty) return [...element.children].some(child => child.textContent.trim() === text) ? 'ready' : 'conflict';
      const editor = element.editor;
      if (!editor?.isEditable || typeof editor.commands.setContent !== 'function') return 'keyboard';
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      return editor.commands.setContent(paragraph.outerHTML, true) ? 'ready' : 'keyboard';
    }, item.text);
    requireValue(content !== 'conflict', 'Тело статьи содержит данные, которых нет в плане.');
    if (content === 'keyboard') {
      await body.press('ControlOrMeta+End', timeout);
      await page.keyboard.insertText(item.text);
    }
    await body.getByText(item.text, { exact: true }).waitFor(timeout);
    if (!await nav.count()) {
      await body.press('ControlOrMeta+End', timeout);
      await body.press('Enter', timeout);
      const menu = page.locator('.dropdown.editor-menu-dropdown > .dropdown__trigger > .simple-button.dropdown__trigger-button:visible');
      await menu.click(timeout);
      await button('Вывод вложенных статей').click(timeout);
      await nav.waitFor({ ...timeout, state: 'attached' });
    }
  }

  const header = page.locator('.editor-title');
  const coverImage = page.locator(
    '.editor [class*="cover"] img[src], .editor [class*="cover"][style*="background-image"], [class*="cover__image"][src]',
  ).filter({ visible: true });

  function emojiPattern(emoji) {
    return new RegExp('^\\s*' + emoji.replace(/\ufe0f/gu, '') + '\\ufe0f?\\s*$', 'u');
  }

  function shownEmoji(item) {
    return header.locator('.editor-title__container').getByText(emojiPattern(item.emoji))
      .or(header.locator('.editor-title__container').getByAltText(emojiPattern(item.emoji)));
  }

  async function setEmoji(item) {
    if (await shownEmoji(item).count()) return;
    await title.hover(timeout);
    await header.locator('.emoji-picker-dropdown .dropdown__trigger > button').click(timeout);
    const picker = header.locator('.emoji-picker-dropdown .dropdown__popover:visible');
    await picker.waitFor(timeout);
    const choice = picker.locator('button.picmo__emojiButton').filter({ hasText: emojiPattern(item.emoji) }).or(
      picker.locator('button[data-emoji=' + JSON.stringify(item.emoji) + '], button:has(img[alt=' + JSON.stringify(item.emoji) + '])'),
    ).filter({ visible: true }).first();
    if (!await choice.first().isVisible()) {
      const search = picker.getByRole('textbox').filter({ visible: true });
      await search.waitFor(timeout);
      const russian = { '🏭': 'завод', '📋': 'планшет', '🔍': 'лупа', '🔧': 'гаечный ключ', '🛡️': 'щит', '📊': 'гистограмма' };
      await search.fill(russian[item.emoji] ?? item.emojiName, timeout);
      if (item.emojiFallback && !await choice.waitFor({ timeout: 1800 }).then(() => true, error => {
        if (error.name !== 'TimeoutError') throw error;
        return false;
      })) await search.fill(item.emojiFallback, timeout);
    }
    await choice.click(timeout);
    await shownEmoji(item).first().waitFor(timeout);
  }

  async function fitCover(item, uploading) {
    const editor = page.locator('.functional-cropper:visible');
    const settings = page.locator('.settings-popup:visible');
    const gear = settings.locator('button.cover-form__file-content-buttons-item:has(use[href="#icon-gear"])');
    if (!uploading && !await settings.isVisible()) {
      await test('article-toolbar-menu').click(timeout);
      await page.locator('.dropdown__popover:visible').getByText('Настройки', { exact: true }).click(timeout);
      await settings.getByText('Обложка', { exact: true }).click(timeout);
    }
    // Teamly открывает кроппер сам после загрузки. Шестерёнка есть у сохранённой обложки.
    await editor.or(gear).first().waitFor(timeout);
    if (!await editor.isVisible()) {
      await gear.click(timeout);
    }
    await editor.waitFor(timeout);
    const source = editor.locator('cropper-canvas > cropper-image');
    await source.waitFor(timeout);
    await page.waitForFunction(() => document.querySelector('.functional-cropper cropper-canvas > cropper-image')?.$image?.naturalWidth > 0,
      null, timeout);
    const split = button('Разъединить области', editor);
    if (await split.count()) await split.click(timeout);
    const image = await source.boundingBox(timeout);
    requireValue(image && image.width > 0, 'Не готово исходное изображение в кроппере.');
    const center = image.x + image.width / 2;
    const crops = [];
    // Доли ширины исходника 2500 × 500. Рамки занимают почти всю доступную высоту.
    for (const [id, format, ratio, proportion] of [['medium', '2.5:1', 2.5, 0.496], ['big', '5:1', 5, 0.984]]) {
      const selection = editor.locator('cropper-selection#' + id);
      await editor.locator('cropper-viewer[selection="#' + id + '"]').click(timeout);
      await selection.and(editor.locator('cropper-selection[active]')).waitFor(timeout);
      const validFrame = frame => frame && Math.abs(frame.width / image.width - proportion) < 0.015 &&
        Math.abs(frame.width / frame.height - ratio) < 0.03 &&
        Math.abs(frame.x + frame.width / 2 - center) < image.width * 0.012 &&
        Math.abs(frame.y + frame.height / 2 - image.y - image.height / 2) < image.height * 0.04;
      await selection.evaluate((frame, { width, height, x, y, ratio }) => {
        if (typeof frame.$change !== 'function') return;
        const box = frame.getBoundingClientRect();
        const scale = box.width / frame.width;
        if (!Number.isFinite(scale) || scale <= 0) return;
        // CropperSelection emits its native change event with coordinates relative to the canvas.
        frame.$change(frame.x + (x - box.x) / scale, frame.y + (y - box.y) / scale, width / scale, height / scale, ratio);
      }, { width: image.width * proportion, height: image.width * proportion / ratio, x: center - image.width * proportion / 2,
        y: image.y + (image.height - image.width * proportion / ratio) / 2, ratio });
      if (!validFrame(await selection.boundingBox(timeout))) {
        for (const [side, direction] of [['w', -1], ['e', 1]]) {
          const handle = selection.locator('cropper-handle[action="' + side + '-resize"]');
          const current = await selection.boundingBox(timeout);
          const rect = await handle.boundingBox(timeout);
          const edge = direction < 0 ? current.x : current.x + current.width;
          const delta = center + direction * image.width * proportion / 2 - edge;
          if (Math.abs(delta) < 1.25) continue;
          const x = rect.x + rect.width / 2;
          const y = rect.y + rect.height / 2;
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x + delta, y, { steps: 4 });
          await page.mouse.up();
        }
      }
      const result = await selection.boundingBox(timeout);
      const fraction = result.width / image.width;
      requireValue(validFrame(result), 'Не удалось подобрать поля кадра ' + id + ' (' + fraction.toFixed(3) + ').');
      crops.push({ format, sourceWidth: Math.round(fraction * 2500) });
    }
    const proof = plan.coverProof?.[item.key];
    if (proof) await editor.screenshot({ ...timeout, path: proof.crop });
    await button('Сохранить', settings).click(timeout);
    await settings.waitFor({ ...timeout, state: 'hidden' });
    await coverImage.first().waitFor(timeout);
    state.objects[item.key].coverCrop = crops;
    if (proof) {
      await coverImage.first().evaluate(element => {
        if (element instanceof HTMLImageElement) return element.decode();
      });
      await coverImage.first().screenshot({ ...timeout, path: proof.header });
    }
  }

  async function setCover(item) {
    if (state.objects[item.key].coverCrop && await coverImage.count()) return;
    const add = button('Добавить обложку', header);
    await title.hover(timeout);
    await coverImage.or(add).first().waitFor(timeout);
    if (await coverImage.count()) return fitCover(item, false);
    requireValue(covers.has(item.key), 'Не подготовлен файл обложки.');
    await add.click(timeout);
    const upload = page.getByText('С компьютера', { exact: true }).filter({ visible: true });
    const [picker] = await Promise.all([page.waitForEvent('filechooser', timeout), upload.click(timeout)]);
    await picker.setFiles(covers.get(item.key), timeout);
    await fitCover(item, true);
  }

  async function findRoot() {
    const root = tree.locator('.tree-item:has(use[href="#icon-space"]) a.tree-item__link');
    await root.waitFor(timeout);
    return urlOf(await root.evaluate(link => link.href));
  }

  async function recoverRoot() {
    const current = new URL(page.url());
    if (current.origin === origin && /^(?:at|sp)$/u.test(route.exec(current.pathname)?.[1] ?? '')) {
      const root = await findRoot();
      await sidebarTitle(root, plan.title);
      return;
    }
    if (current.pathname === '/space/list/all') {
      await page.reload({ ...timeout, waitUntil: 'domcontentloaded' });
    }
    const existing = await spacesNamed();
    requireValue(await existing.count() === 1, 'В списке не найдено единственное пространство «' + plan.title + '» после создания.');
    const spaceLink = page.locator('a.root-entity-cards-item__content-main[href*="/sp/"]').filter({ has: existing });
    await spaceLink.click(timeout);
    await page.waitForURL(url => url.origin === origin && /^(?:at|sp)$/u.test(route.exec(url.pathname)?.[1] ?? ''), timeout);
    await sidebarTitle(await findRoot(), plan.title);
  }

  async function openFromTree(url) {
    if (page.url() === url) return;
    await row(url).locator('a.tree-item__link').click(timeout);
    await page.waitForURL(url, timeout);
  }

  async function createSection(item, root) {
    const existing = await children(root);
    requireValue(!existing.some(child => child.title === item.title || !child.url ||
      (child.draft && (!child.title || child.title === 'Без названия'))),
    'В дереве есть совпадение или незавершённый черновик. Сверьте его URL перед повтором.');
    await row(root).hover(timeout);
    await row(root).locator('.tree-item__dropdown-action:has(use[href="#icon-plus"])').click(timeout);
    const database = item.kind === 'database';
    const create = database ? test('create-database-button').or(button('Умная таблица')) : test('create-article-button');
    await create.waitFor(timeout);
    const before = page.url();
    state.pendingChildren ??= {};
    state.pendingChildren[item.key] = existing.map(child => child.url);
    state.steps[item.key + ':create'] = 'pending';
    await save();
    await create.click(timeout);
    const kind = database ? 'db' : 'at';
    await page.waitForURL(url => url.origin === origin && route.exec(url.pathname)?.[1] === kind && url.href !== before, timeout);
    const url = urlOf(page.url(), kind);
    state.objects[item.key] = { url, status: 'черновик' };
    await save();
    if (!plan.singlePass) await placement(root, url, !database, database ? undefined : item.title);
    delete state.pendingChildren[item.key];
    state.steps[item.key + ':create'] = 'created';
    return url;
  }

  async function recoverSection(item, parent) {
    const previous = state.pendingChildren?.[item.key];
    requireValue(previous, 'Не сохранён снимок ветки до создания «' + item.title + '».');
    if (!await row(parent).isVisible() || page.url() === parent) {
      await page.goto(parent, { ...timeout, waitUntil: 'domcontentloaded' });
    }
    const prefix = item.kind === 'database' ? '/db/' : '/at/';
    const known = new Set([...previous, ...Object.values(state.objects).map(entry => entry.url)]);
    const candidates = (await children(parent)).filter(node => node.url && !known.has(node.url) &&
      new URL(node.url).pathname.startsWith(prefix));
    requireValue(candidates.length === 1,
      'Не найден единственный новый объект «' + item.title + '» в боковой панели.');
    const [candidate] = candidates;
    requireValue(candidate.title === item.title || (
      (!candidate.title || /^(Без названия|Новая таблица)$/u.test(candidate.title)) &&
      (item.kind === 'database' || candidate.draft)
    ), 'Новый объект отличается от «' + item.title + '».');
    state.objects[item.key] = { url: candidate.url, status: 'черновик' };
    state.steps[item.key + ':create'] = 'created';
    delete state.pendingChildren[item.key];
    await save();
    return candidate.url;
  }

  const databaseTitle = page.locator('[data-test-id="database-title"]:is(input,textarea,[contenteditable]), [data-test-id="database-title"] :is(input,textarea,[contenteditable])').filter({ visible: true });

  async function confirmDatabaseTitle(item, url, parent, edit = false) {
    const label = () => row(url).locator('.tree-item__text').innerText(sidebarTimeout);
    const heading = () => databaseTitle.evaluate(el => (el.value ?? el.innerText).trim());
    const check = async (write, afterRefresh = false) => {
      const treeTimeout = afterRefresh ? timeout : sidebarTimeout;
      const [, initial] = await Promise.all([databaseTitle.waitFor(timeout), children(parent, treeTimeout)]);
      const matches = node => node.url === url && node.title === item.title && !node.draft;
      const current = await heading();
      if (current === item.title && initial.some(matches)) return true;
      const untitled = !current || current === 'Без названия';
      if (current !== item.title && (write || (afterRefresh && untitled)) && initial.some(node => node.url === url)) {
        await databaseTitle.fill(item.title, timeout);
        await databaseTitle.press('Tab', timeout);
      }
      if (await heading() !== item.title) return false;
      try {
        await sidebarTitle(url, item.title, sidebarTimeout);
      } catch (error) {
        if (error.name !== 'TimeoutError') throw error;
        return false;
      }
      return (await children(parent, treeTimeout)).some(matches);
    };
    try {
      if (await check(edit)) return;
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
    }

    // Только проблемная ТБД. Сначала перечитываем дерево, чтобы не отправить повторное сохранение вслепую.
    requireValue(urlOf(page.url(), 'db') === url, 'Открылась другая таблица.');
    await page.reload({ ...timeout, waitUntil: 'domcontentloaded' });
    reopened += 1;
    if (await check(edit, true)) return;
    const actualName = await label().catch(() => 'строка отсутствует');
    throw new Error('ТБД «' + item.title + '» не подтверждена в боковой панели родителя: «' + actualName + '».');
  }

  async function styleDatabase(item, url, parent) {
    stage = item.key + ' / название ТБД';
    const entry = state.objects[item.key];
    try {
      await confirmDatabaseTitle(item, url, parent, true);
      if (plan.singlePass) {
        // The sidebar can reflect an optimistic title before Teamly persists it.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await page.reload({ ...timeout, waitUntil: 'domcontentloaded' });
          reopened += 1;
          requireValue(urlOf(page.url(), 'db') === url, 'Открылась другая таблица.');
          await databaseTitle.waitFor(timeout);
          const heading = await databaseTitle.evaluate(el => (el.value ?? el.innerText).trim());
          if (heading === item.title) {
            await sidebarTitle(url, item.title, timeout);
            break;
          }
          requireValue(attempt === 0, 'Название ТБД «' + item.title + '» не сохранилось после повторного открытия.');
          await confirmDatabaseTitle(item, url, parent, true);
        }
      }
    } catch (error) {
      entry.issues = [error.message.split('\n')[0]];
      await save({ report: true }).catch(() => {});
      throw error;
    }
    Object.assign(entry, { status: 'собрано', issues: [], sidebarTitle: item.title });
    await save({ report: true });
  }

  async function decorate(item, measurements) {
    const issues = [];
    const actions = [['emoji', 'эмодзи', setEmoji]];
    if (needsCover(item)) actions.push(['cover', 'обложка', setCover]);
    for (const [key, label, action] of actions) {
      const began = Date.now();
      try {
        await action(item);
      } catch (error) {
        issues.push(label + ' — ' + error.message.split('\n')[0]);
        await page.keyboard.press('Escape');
        if (key === 'cover') {
          // Сохраняем опубликованную статью и останавливаемся до следующей загрузки.
          Object.assign(state.objects[item.key], { status: 'опубликовано', issues });
          await save();
          throw error;
        }
      } finally {
        if (measurements) measurements[key] = Date.now() - began;
      }
    }
    return issues;
  }

  async function styleArticle(item, url, root) {
    const measurements = timings.articles[item.key];
    stage = item.key + ' / текст и навигация';
    const editing = Date.now();
    await setTextAndNav(item, url);
    measurements.content = Date.now() - editing;
    stage = item.key + ' / публикация';
    const publishing = Date.now();
    await publishIfDraft(url);
    if (!plan.singlePass && item.key !== 'ROOT') await placement(root, url, false, item.title);
    measurements.publish = Date.now() - publishing;
    stage = item.key + ' / эмодзи и два кадра обложки';
    const issues = await decorate(item, measurements);
    Object.assign(state.objects[item.key], { status: 'собрано', issues });
    await save({ report: true });
  }

  function cardLinks() {
    return page.locator('[class*="nested-articles"] a[href*="/at/"]:visible');
  }

  async function checkCards(key = 'ROOT') {
    const toolbar = test('article-toolbar-menu');
    await toolbar.click(timeout);
    const nested = page.locator('label.switcher:has(input#nestedArticles):visible');
    await nested.waitFor(timeout);
    if (!await nested.locator('input').isChecked(timeout)) await nested.click(timeout);
    await title.click(timeout);
    const area = page.locator('.article-nested-articles');
    await area.waitFor(timeout);
    if (!await area.locator('.articles-cards-view').count()) {
      await area.hover(timeout);
      const menu = area.locator('.nested-articles-dropdown__btn:visible');
      if (await menu.count() === 1) {
        await menu.click(timeout);
        const format = page.getByText('Большие карточки', { exact: true }).filter({ visible: true });
        if (await format.waitFor({ timeout: 2500 }).then(() => true, () => false)) {
          await format.click(timeout);
          await area.locator('.articles-cards-view-item').first().waitFor(timeout);
        } else await title.click(timeout);
      }
    }
    const sections = plan.structureOnly ? plan.pages.filter(item => item.parent === key && item.kind !== 'database') : plan.pages.slice(1);
    if (plan.structureOnly) {
      const paths = sections.map(item => new URL(state.objects[item.key].url).pathname);
      await page.waitForFunction(expected => {
        const cards = [...document.querySelectorAll('.article-nested-articles .articles-cards-view a[href]')];
        return expected.every(path => cards.some(link => link.pathname === path &&
          (link.querySelector('img[src], [style*="background-image"]') ||
            link.closest('[class*="card"]')?.querySelector('img[src], [style*="background-image"]'))));
      }, paths, timeout);
    }
    const cards = await cardLinks().evaluateAll(links => links.map(link => ({
      title: link.innerText.trim(),
      url: link.origin + link.pathname,
      cover: Boolean(link.querySelector('img[src], [style*="background-image"]')) ||
        Boolean(link.closest('[class*="card"]')?.querySelector('img[src], [style*="background-image"]')),
    })));
    const found = sections.filter(item => cards.some(card =>
      card.url === state.objects[item.key].url && card.title.includes(item.title) && card.cover));
    const links = sections.map(item => ({ title: item.title, url: state.objects[item.key].url }));
    if (plan.coverProof?.[key] && found.length === sections.length) {
      await area.screenshot({ ...timeout, path: plan.coverProof[key].cards });
    }
    if (plan.structureOnly) return { verified: found.length === sections.length, withCover: found.length, expected: sections.length };
    const directLinks = links.filter(link => !cards.some(card => card.url === link.url));
    const inserted = await body.evaluate((element, { links, directLinks }) => {
      const editor = element.editor;
      if (!editor?.isEditable) return false;
      const legacy = [];
      editor.state.doc.forEach((block, position) => {
        const child = block.firstChild;
        if (block.type.name === 'paragraph' && block.childCount === 1 &&
          links.some(link => link.title === child.text) && child.marks.some(mark =>
            mark.type.name === 'link' && mark.attrs.link === null)) legacy.push({ from: position, to: position + block.nodeSize });
      });
      for (const range of legacy.reverse()) editor.commands.deleteRange(range);
      const existing = new Set([...element.querySelectorAll('a[href]')].map(anchor => anchor.href));
      const missing = directLinks.filter(link => !existing.has(link.url));
      if (!missing.length) return true;
      const container = document.createElement('div');
      for (const link of missing) {
        const paragraph = container.appendChild(document.createElement('p'));
        const anchor = paragraph.appendChild(document.createElement('a'));
        anchor.href = link.url;
        anchor.dataset.url = link.url;
        anchor.dataset.type = 'external';
        anchor.dataset.editorLink = 'true';
        anchor.textContent = link.title;
      }
      return editor.commands.insertContentAt(editor.state.doc.content.size, container.innerHTML);
    }, { links, directLinks });
    requireValue(inserted, 'Teamly отклонил добавление ссылок на разделы.');
    for (const link of directLinks) {
      await body.locator('a[href=' + JSON.stringify(link.url) + ']').first().waitFor(timeout);
    }
    const nativeTree = await body.locator('.nested-articles-tree-item.published:not(.root)').evaluateAll(items =>
      items.map(item => [item.getAttribute('keyname'), item.textContent.trim()]));
    const listed = links.filter(link => nativeTree.some(([id, label]) => link.url.endsWith('/' + id) && label === link.title));
    return { verified: true, withCover: found.length, directLinks: directLinks.length, nativeTree: listed.length };
  }

  async function rootAccess(action = 'apply') {
    if (!plan.rights.length) return { status: plan.structureOnly ? 'ожидаются участники и уровни доступа' : 'пропущено' };
    const access = button('Доступ');
    const dialog = page.locator('.access-popup:visible');
    await access.click(timeout);
    await dialog.waitFor(timeout);

    function locateSubject(subject) {
      return dialog.locator('.access-form-item').filter({
        has: page.getByText(subject.name, { exact: true }), hasText: subject.match || undefined,
      });
    }

    const verify = async () => {
      await Promise.all(plan.rights.map(subject => locateSubject(subject).getByText(subject.level, { exact: true }).waitFor(timeout)));
      await page.keyboard.press('Escape');
      return { status: 'назначения проверены', count: plan.rights.length, assignments: plan.rights,
        inheritance: 'проверка под ролями не выполнена' };
    };
    if (action === 'verify') return verify();

    const types = { user: 'пользователи', department: 'структура', group: 'группы' };
    const missing = [];
    for (const subject of plan.rights) {
      const count = await locateSubject(subject).count();
      requireValue(count <= 1, 'В панели несколько совпадений для «' + subject.name + '».');
      if (!count) missing.push(subject);
    }
    if (missing.length) {
      const toggle = dialog.locator('button.tabbed-select__content-result-button');
      await toggle.click(timeout);
      const picker = dialog.locator('.tabbed-select__content-dropdown:visible');
      await picker.waitFor(timeout);
      for (const [type, tab] of Object.entries(types)) {
        const subset = missing.filter(subject => subject.type === type);
        if (!subset.length) continue;
        await button(tab, picker).click(timeout);
        for (const subject of subset) {
          const option = picker.locator('label:has(input[type="checkbox"])').filter({
            has: page.getByText(subject.name, { exact: true }), hasText: subject.match || undefined,
          });
          const selected = option.locator('input[type="checkbox"]');
          if (!await selected.isChecked(timeout)) await option.click(timeout);
          requireValue(await selected.isChecked(timeout), 'Участник не выбран: ' + subject.name);
        }
      }
      const add = button('Добавить', dialog);
      if (await add.count()) await add.click(timeout);
      if (await picker.isVisible()) await toggle.click(timeout);
      if (plan.fullSpace) {
        await button('Сохранить', dialog).click(timeout);
        await dialog.waitFor({ ...timeout, state: 'hidden' });
        await access.click(timeout);
        await dialog.waitFor(timeout);
      }
    }

    for (const subject of plan.rights) {
      const row = locateSubject(subject);
      const combo = row.locator('.vs__dropdown-toggle');
      await row.waitFor(timeout);
      const level = row.getByText(subject.level, { exact: true });
      if (!await level.count()) {
        await combo.click(timeout);
        const option = page.locator('.vs__dropdown-option:visible');
        const name = page.getByText(subject.level, { exact: true });
        await option.and(name).or(option.filter({ has: name })).click(timeout);
      }
      await level.waitFor(timeout);
    }
    await button('Сохранить', dialog).click(timeout);
    await dialog.waitFor({ ...timeout, state: 'hidden' });
    if (action === 'write') return { status: 'назначения сохранены' };
    await access.click(timeout);
    await dialog.waitFor(timeout);
    return verify();
  }

  async function completeSpaceSettings(verify = true) {
    const space = urlOf(state.objects.space?.url, 'sp');
    stage = 'глоссарий';
    const glossaryStarted = Date.now();
    const glossaryUrl = space + '/glossary/articles';
    await page.goto(glossaryUrl, { ...timeout, waitUntil: 'domcontentloaded' });
    const add = button('Добавить термин');
    await add.waitFor(timeout);
    requireValue(page.url() === glossaryUrl, 'Открылся глоссарий другого пространства.');
    const field = page.locator('input[placeholder="Введите текст"]:visible');
    const definition = page.locator('textarea[placeholder="Введите текст"]:visible');
    const termRow = term => page.getByRole('row').filter({
      has: page.getByRole('cell', { name: term, exact: true }),
    });
    if (!verify || !plan.singlePass) {
      for (const item of plan.glossary) {
        const term = termRow(item.term);
        if (await term.count()) continue;
        await add.click(timeout);
        await field.fill(item.term, timeout);
        await definition.fill(item.definition, timeout);
        await button('Сохранить').click(timeout);
        await field.waitFor({ ...timeout, state: 'hidden' });
        await term.waitFor(timeout);
      }
    }
    if (!verify) {
      timings.glossaryWrite = Date.now() - glossaryStarted;
      return;
    }
    state.glossary = [];
    for (const { term, definition } of plan.glossary) {
      await termRow(term).getByRole('cell', { name: definition, exact: true }).waitFor(timeout);
      state.glossary.push(term);
    }
    await save();
    timings.glossary = Date.now() - glossaryStarted;

    stage = 'сохранённые модули пространства';
    const modulesStarted = Date.now();
    const settingsUrl = space + '/settings/main';
    await page.goto(settingsUrl, { ...timeout, waitUntil: 'domcontentloaded' });
    requireValue(page.url() === settingsUrl, 'Открылись настройки другого пространства.');
    state.modules = [];
    for (const name of plan.modules) {
      const module = page.locator('.settings-card__block').filter({ has: page.getByText(name, { exact: true }) });
      const input = module.locator('input[type="checkbox"]');
      await input.waitFor({ ...timeout, state: 'attached' });
      requireValue(await input.isChecked(timeout), 'Модуль «' + name + '» не подтверждён.');
      state.modules.push(name);
    }
    await save({ report: true });
    timings.modules = Date.now() - modulesStarted;
  }

  async function rememberSpaceFromArticle() {
    if (state.objects.space?.url) return;
    const spaceHref = await body.evaluate(el => {
      const nav = el.editor?.getJSON()?.content?.find(block => block.type === 'nestedArticles');
      const path = '/sp/' + nav?.attrs.spaceId;
      const link = [...document.querySelectorAll('a[href*="/sp/"]')].find(link => link.pathname === path);
      return link?.href;
    });
    if (spaceHref) {
      state.objects.space = { url: urlOf(spaceHref, 'sp') };
      await save();
    }
  }

  async function verifyPage(item, root, alreadyOpen = false) {
    stage = item.key + ' / итоговая сверка';
    const entry = state.objects[item.key];
    const parent = state.objects[item.parent ?? 'ROOT'].url;
    if (plan.singlePass && item.kind === 'database' && state.tableContent?.ok) {
      // Заголовок и содержимое уже проверены в сессии таблицы. Здесь проверяем место в дереве.
      if (!await tree.isVisible()) await page.goto(root, { ...timeout, waitUntil: 'domcontentloaded' });
      await placement(parent, entry.url, false, item.title);
      entry.checks = { title: true, sidebarTitle: true, placement: true, data: true };
      entry.sidebarTitle = item.title;
      return entry.checks;
    }
    if (!alreadyOpen && page.url() !== entry.url) {
      await page.goto(entry.url, { ...timeout, waitUntil: 'domcontentloaded' });
      reopened += 1;
    }
    if (item.kind === 'database') {
      await confirmDatabaseTitle(item, entry.url, parent);
      const populated = state.tableContent?.ok && state.tableContent.rows.some(row => row.key === item.key);
      entry.checks = { title: true, sidebarTitle: true, placement: true };
      if (populated) entry.checks.data = true;
      else entry.checks.empty = !await page.locator('.row:has(.database-title.row__cell)').count();
      entry.sidebarTitle = item.title;
      return entry.checks;
    }
    const direct = item.key === 'ROOT' ? [] : await children(parent);
    await Promise.all([
      title.and(page.getByText(item.title, { exact: true })).waitFor(timeout),
      item.key === 'ROOT' ? sidebarTitle(entry.url, item.title) : undefined,
      plan.structureOnly ? (state.content?.[item.key]?.written ? body.waitFor(timeout) : assertEmptyArticle()) :
        body.getByText(item.text, { exact: true }).waitFor(timeout),
    ]);
    if (entry.issues?.length && !await shownEmoji(item).count()) {
      try {
        await setEmoji(item);
        entry.issues = [];
      } catch (error) {
        entry.issues = ['эмодзи — ' + error.message.split('\n')[0]];
        await page.keyboard.press('Escape');
      }
    }
    const emoji = Boolean(await shownEmoji(item).count());
    if (emoji && entry.issues?.length) entry.issues = entry.issues.filter(issue => !issue.startsWith('эмодзи — '));
    const placementCheck = item.key === 'ROOT' ? entry.url === root : Boolean(
      direct.find(child => child.url === entry.url && !child.draft && child.title === item.title));
    entry.checks = {
      text: true,
      published: !await publish.isVisible() && !await row(entry.url).locator(draftIcon).count(),
      placement: placementCheck,
      emoji,
      ...(needsCover(item) && {
        cover: Boolean(await coverImage.count()),
        crop: entry.coverCrop?.length === 2,
      }),
      navigation: plan.structureOnly || Boolean(await nav.count()),
    };
    return entry.checks;
  }

  function objectVerified(item) {
    if (!checksPassed(state.objects[item.key].checks)) return false;
    if (state.content?.[item.key] && !state.content[item.key].verification) return false;
    if (item.key === 'ROOT') return Boolean(state.cards?.verified &&
      (!plan.rights.length || state.rights?.status === 'назначения проверены'));
    return !plan.structureOnly || item.key !== 'SUPER' || Boolean(state.superCards?.verified);
  }

  try {
    stage = 'подготовка обложек';
    const preparing = Date.now();
    const assembled = item => state.objects[item.key]?.status === 'собрано' &&
      (!needsCover(item) || state.objects[item.key].coverCrop?.length === 2);
    const coverPages = plan.pages.filter(item => needsCover(item) && (!apply || !assembled(item)));
    await makeCovers(coverPages);
    timings.covers = Date.now() - preparing;
    const rootState = state.objects.ROOT;
    const finalOnly = plan.pages.every(assembled);
    if (!apply) {
      stage = 'мастер / проверка';
      const setup = Date.now();
      await wizard();
      timings.space = Date.now() - setup;
      timings.total = Date.now() - started;
      return {
        ok: true, mode: 'preview', title: plan.title, template: 'С нуля',
        checked: 'доступна финальная кнопка «Создать»', pages: plan.pages.map(({ key, title }) => ({ key, title })),
        covers: covers.size, rights: plan.rights.length ? 'матрица задана' : 'ожидает матрицу доступа', reopened, timingsMs: timings,
      };
    }

    stage = 'мастер / создание';
    const setup = Date.now();
    if (!rootState?.url) {
      const creatingRoot = Date.now();
      if (state.steps['space:create'] === 'pending') {
        requireValue(plan.singlePass, 'Итог прошлого нажатия неизвестен. Укажите подтверждённый URL корневой через --resume-root.');
        await recoverRoot();
      } else {
        const finish = await wizard();
        state.steps['space:create'] = 'pending';
        await save();
        await finish.click(timeout);
        await page.waitForURL(url => url.origin === origin && route.test(url.pathname), timeout);
      }
      if (route.exec(new URL(page.url()).pathname)?.[1] === 'sp') {
        state.objects.space = { url: urlOf(page.url(), 'sp') };
      }
      const root = await findRoot();
      timings.rootCreation = Date.now() - creatingRoot;
      state.objects.ROOT = { url: root, status: 'найдено' };
      state.steps['space:create'] = 'created';
      await save();
      await openFromTree(root);
      if (plan.structureOnly) {
        const spaceHref = await page.locator('a[href*="/sp/"]').evaluateAll(links =>
          [...new Set(links.map(link => link.href))]);
        if (spaceHref.length === 1) state.objects.space = { url: urlOf(spaceHref[0], 'sp') };
        await save();
      }
    } else if (!finalOnly) {
      if (!await row(rootState.url).isVisible()) {
        await page.goto(rootState.url, { ...timeout, waitUntil: 'domcontentloaded' });
      }
      await sidebarTitle(rootState.url, plan.title);
      await children(rootState.url);
    }
    timings.space = Date.now() - setup;

    const root = state.objects.ROOT.url;
    const assembling = Date.now();
    for (const item of plan.pages) {
      let url = state.objects[item.key]?.url;
      if (assembled(item)) continue;
      const parent = state.objects[item.parent ?? 'ROOT']?.url;
      requireValue(parent, 'Родитель не подтверждён для «' + item.title + '».');
      const opening = Date.now();
      if (url) {
        if (item.key !== 'ROOT') {
          const node = (await children(parent)).find(child => child.url === url);
          requireValue(node && (node.title === item.title || (node.draft && node.title === 'Без названия') || item.kind === 'database'),
            'Сохранённый URL не указывает на раздел плана под нужной корневой.');
          state.steps[item.key + ':create'] = 'created';
        }
        await openFromTree(url);
      } else {
        stage = item.key + ' / создание';
        if (state.steps[item.key + ':create'] === 'pending') {
          requireValue(plan.singlePass, 'Итог прошлого создания неизвестен. Укажите URL через --resume-section.');
          url = await recoverSection(item, parent);
          await openFromTree(url);
        } else {
          url = await createSection(item, parent);
        }
      }
      timings.articles[item.key] = { open: Date.now() - opening };
      if (item.kind === 'database') {
        const editing = Date.now();
        await styleDatabase(item, url, parent);
        timings.articles[item.key].content = Date.now() - editing;
      } else {
        await styleArticle(item, url, parent);
        if (plan.singlePass && item.key === 'ROOT') await rememberSpaceFromArticle();
      }
      if (item.key === stopAfter) {
        return { ok: !state.objects[item.key].issues?.length && !state.objects.ROOT.issues?.length,
          mode: 'checkpoint', key: item.key, space: state.objects.space?.url, pages: state.objects, reopened };
      }
    }
    timings.articlesTotal = Date.now() - assembling;

    if (content) {
      stage = 'наполнение суперстатьи и вложенных';
      const filling = Date.now();
      try {
        timings.contentPages = await content.fill(state, save);
      } finally {
        timings.content = Date.now() - filling;
      }
    }
    if (articles) {
      stage = 'наполнение рабочих статей';
      const filling = Date.now();
      try {
        timings.workArticles = await articles.fill(state, save);
      } finally {
        timings.workArticlesMs = Date.now() - filling;
      }
    }

    if (plan.singlePass) {
      if (state.steps['space:glossary'] !== 'written') {
        await completeSpaceSettings(false);
        state.steps['space:glossary'] = 'written';
        await save();
      }
      const writeTasks = [
        ['наполнение умных таблиц', tables && !state.tableContent?.ok && !state.tableWrite?.ok, async () => {
          const begun = Date.now();
          try {
            state.tableWrite = await tables(state.objects, 'write', state.tableWrite);
            await save();
            requireValue(state.tableWrite.ok, 'Не записаны данные или настройки таблиц. Подробности в tableWrite.');
          } finally { timings.tableContentMs = Date.now() - begun; }
        }],
        ['создание курса', course && !state.course?.ok && !state.courseWrite?.ok, async () => {
          const begun = Date.now();
          try {
            state.courseWrite = await course(state.objects, state.courseWrite ?? state.course, 'write', async progress => {
              state.courseWrite = { ...progress };
              await save();
            });
            await save();
            requireValue(state.courseWrite.ok, 'Не записаны все модули, материалы или тесты. Подробности в courseWrite.');
          } finally { timings.course = Date.now() - begun; }
        }],
      ].filter(([, needed]) => needed);
      if (writeTasks.length) {
        const begun = Date.now();
        const results = await Promise.allSettled(writeTasks.map(([, , write]) => write()));
        timings.parallelWriteMs = Date.now() - begun;
        const failed = results.findIndex(result => result.status === 'rejected');
        if (failed !== -1) {
          stage = writeTasks[failed][0];
          throw results[failed].reason;
        }
      }
      if (plan.rights.length && state.steps['space:rights'] !== 'written') {
        stage = 'права корневой статьи';
        const begun = Date.now();
        if (page.url() !== root) {
          await page.goto(root, { ...timeout, waitUntil: 'domcontentloaded' });
          reopened += 1;
        }
        try {
          await rootAccess('write');
        } catch (error) {
          await page.keyboard.press('Escape');
          throw error;
        }
        state.steps['space:rights'] = 'written';
        timings.rightsWrite = Date.now() - begun;
        await save();
      }
      if (tables && !state.tableContent?.ok) {
        stage = 'итоговая проверка умных таблиц';
        const begun = Date.now();
        state.tableContent = await tables(state.objects, 'verify', state.tableContent?.failed ? state.tableContent : undefined);
        if (!state.tableContent.ok) {
          const { failed, dataFailed } = state.tableContent;
          state.tableWrite = { ...state.tableWrite, ok: false, failed,
            advancedOnly: failed.filter(key => !dataFailed.includes(key)) };
        }
        await save();
        timings.tableVerificationMs = Date.now() - begun;
        requireValue(state.tableContent.ok, 'Не подтверждены данные или настройки таблиц. Подробности в tableContent.');
      }
    }

    // Во время штатной сборки Teamly сам открывает новый черновик.
    // Итоговая сверка открывает статьи после сохранения всех обложек.
    verifying = Date.now();
    for (const item of plan.pages) {
      const entry = state.objects[item.key];
      const step = item.key + ':verify';
      if (state.verification?.key !== item.key && objectVerified(item) &&
          (state.steps[step] === 'verified' || (resumeVerification && finalOnly))) continue;
      state.verification = { key: item.key, url: entry.url };
      await save();
      const verifyingItem = Date.now();
      await verifyPage(item, root, finalOnly && item.key === 'ROOT' && page.url() === root);
      if (item.key === 'ROOT') {
        stage = 'корневая / карточки и доступ';
        await rememberSpaceFromArticle();
        const rootCardsStarted = Date.now();
        try { state.cards = await checkCards(); }
        catch (error) { state.cards = { verified: false, reason: error.message.split('\n')[0] }; }
        timings.rootCards = Date.now() - rootCardsStarted;
        const rightsStarted = Date.now();
        try { state.rights = await rootAccess(plan.singlePass ? 'verify' : 'apply'); }
        catch (error) {
          state.rights = { status: 'не подтверждено', reason: error.message.split('\n')[0] };
          delete state.steps['space:rights'];
          await page.keyboard.press('Escape');
        }
        timings.rights = Date.now() - rightsStarted;
      }
      if (plan.structureOnly && item.key === 'SUPER') {
        const superCardsStarted = Date.now();
        try { state.superCards = await checkCards('SUPER'); }
        catch (error) { state.superCards = { verified: false, reason: error.message.split('\n')[0] }; }
        timings.superCards = Date.now() - superCardsStarted;
        if (state.rights?.status === 'назначения проверены') {
          const inheritanceStarted = Date.now();
          const access = button('Доступ');
          const panel = page.locator('.access-popup:visible');
          await access.click(timeout);
          await panel.waitFor(timeout);
          const inherited = await Promise.all(plan.rights.map(({ name }) => panel.getByText(name, { exact: true }).first()
            .waitFor({ timeout: 4500 }).then(() => true, () => false)));
          state.rights.inheritance = inherited.every(Boolean)
            ? (plan.rights.length === 6 ? 'все шесть назначений видны на суперстатье' : 'все ' + plan.rights.length + ' назначений видны на суперстатье')
            : 'проверены настройки корневой';
          await page.keyboard.press('Escape');
          timings.inheritance = Date.now() - inheritanceStarted;
        }
      }
      const contentEntry = state.content?.[item.key];
      const handler = contentEntry?.kind === 'work' ? articles : content;
      if (handler && contentEntry?.written && !contentEntry.verification) {
        stage = item.key + ' / проверка наполнения';
        const verifyingContent = Date.now();
        await handler.verify(page, item, state);
        timings.contentVerification ??= {};
        timings.contentVerification[item.key] = Date.now() - verifyingContent;
      }
      timings.verification[item.key] = Date.now() - verifyingItem;
      if (objectVerified(item)) state.steps[step] = 'verified';
      delete state.verification;
      await save();
    }
    timings.verify = Date.now() - verifying;
    if (plan.structureOnly && state.steps['space:settings'] !== 'verified') {
      const settingsStarted = Date.now();
      try {
        await completeSpaceSettings();
      } catch (error) {
        if (plan.singlePass && stage === 'глоссарий') {
          delete state.steps['space:glossary'];
          await save();
        }
        throw error;
      }
      state.steps['space:settings'] = 'verified';
      await save();
      timings.settings = Date.now() - settingsStarted;
    }
    if (!plan.singlePass && tables && !state.tableContent?.ok) {
      stage = 'наполнение умных таблиц';
      const begun = Date.now();
      try {
        state.tableContent = await tables(state.objects);
        if (state.tableContent.ok) {
          for (const row of state.tableContent.rows) {
            delete state.objects[row.key].checks.empty;
            state.objects[row.key].checks.data = true;
          }
        }
        await save({ report: true });
        requireValue(state.tableContent.ok, 'Не подтверждены настройки или значения умных таблиц. Подробности в tableContent.');
      } finally {
        timings.tableContentMs = Date.now() - begun;
      }
    }
    if (course && !state.course?.ok) {
      stage = plan.singlePass ? 'итоговая проверка курса' : 'создание курса';
      const begun = Date.now();
      state.course = await course(state.objects, plan.singlePass ? state.courseWrite : state.course, plan.singlePass ? 'verify' : 'apply');
      if (plan.singlePass) {
        timings.courseVerificationMs = Date.now() - begun;
        if (!state.course.ok) {
          const failed = new Set(state.course.errors.map(error => error.title));
          const filter = item => !failed.has(undefined) && !failed.has(item.title);
          state.courseWrite = { ...state.courseWrite, ok: false,
            materials: state.courseWrite.materials.filter(filter), tests: state.courseWrite.tests.filter(filter),
            verified: [...state.course.materials, ...state.course.tests] };
        }
      } else timings.course = Date.now() - begun;
      await save({ report: true });
      requireValue(state.course.ok, 'Курс требует продолжения. Подробности в course.errors.');
    }
    timings.total = Date.now() - started;
    const pages = state.objects;
    const checked = plan.pages.filter(item => checksPassed(pages[item.key].checks));
    const articlesVerified = checked.filter(item => item.kind !== 'database').length;
    const verified = checked.length === plan.pages.length && state.cards.verified &&
      (!plan.structureOnly || state.superCards?.verified) && plan.pages.every(objectVerified);
    return {
      ok: verified,
      complete: verified && (!plan.rights.length || state.rights.status === 'назначения проверены'),
      mode: 'apply', space: pages.space?.url, articlesVerified, reopened, pages, cards: state.cards, rights: state.rights,
      tablesVerified: checked.length - articlesVerified, superCards: state.superCards,
      modules: state.modules, glossary: state.glossary,
      ...((content || articles) && { content: state.content }),
      ...(tables && { tableContent: state.tableContent }),
      ...(course && { course: state.course }),
      timingsMs: timings,
    };
  } catch (error) {
    timings.total = Date.now() - started;
    if (verifying && timings.verify === undefined) timings.verify = Date.now() - verifying;
    if (state.verification) {
      state.verification.reason = error.message.split('\n')[0];
      await save({ report: true }).catch(() => {});
    }
    const waiting = error.message.split('\n').find(line => line.includes('waiting for locator'))?.trim();
    throw new Error(JSON.stringify({ stage, reason: error.message.split('\n')[0], waiting, objects: state.objects, timingsMs: timings }));
  }
}

function validate(plan) {
  const { host, title, description, pages, rights } = plan;
  const url = new URL(host);
  if (url.protocol !== 'https:' || url.href !== url.origin + '/') throw new Error('Укажите HTTPS-хост Teamly.');
  const keys = ['ROOT', 'SEC-01', 'SEC-02', 'SEC-03', 'SEC-04', 'SEC-05'];
  if (plan.structureOnly) {
    const parents = new Set();
    const siblings = new Set();
    for (const page of pages) {
      const first = parents.size === 0;
      const sibling = JSON.stringify([page.parent, page.title]);
      if (!page.key || !page.title || parents.has(page.key) ||
          (first ? page.key !== 'ROOT' || page.parent : !parents.has(page.parent)) ||
          siblings.has(sibling) || (page.kind !== 'database' && (!page.emoji || (needsCover(page) && !page.icon)))) {
        throw new Error('Некорректное дерево профиля у «' + page.title + '».');
      }
      parents.add(page.key);
      siblings.add(sibling);
    }
    const expectedTables = plan.fullSpace ? 7 : 5;
    const articles = pages.filter(item => item.kind !== 'database');
    if (plan.singlePass && (articles.length !== Object.keys(articlePositions).length || articles.some(page => {
      const slot = articlePositions[page.key];
      return !slot || (page.parent ?? null) !== slot[0];
    }))) throw new Error('Нужны корневая, суперстатья с тремя вложенными, пять разделов и по три статьи в разделах 1–4.');
    if (pages.filter(item => item.kind === 'database').length !== expectedTables || pages[0].title !== title ||
        !Object.keys(moduleIds).every(name => plan.modules?.includes(name)) || plan.glossary?.length !== 5) {
      throw new Error('Неполный профиль пространства.');
    }
  } else if (!title || !description || pages.length !== keys.length ||
      pages.some((page, index) => page.key !== keys[index] || !page.title || !page.text || !page.emoji || !page.icon) ||
      pages[0].title !== title || pages.at(-1).title !== 'Примеры использования ТБД' ||
      new Set(pages.map(page => page.title)).size !== keys.length) {
    throw new Error('План должен содержать корневую и пять разных разделов с текстом, эмодзи и обложкой.');
  }
  const levels = new Set(['Просмотр', 'Редактирование', 'Публикация', 'Полный доступ']);
  const users = plan.structureOnly && !plan.fullSpace ? 3 : 5;
  if (!Array.isArray(rights) || (rights.length && (
    rights.length !== users + 3 || rights.filter(item => item.type === 'user').length !== users ||
    rights.filter(item => item.type === 'department').length !== 2 || rights.filter(item => item.type === 'group').length !== 1 ||
    rights.some(item => typeof item.name !== 'string' || !item.name.trim() || !levels.has(item.level)) ||
    new Set(rights.map(item => JSON.stringify([item.type, item.name, item.match ?? '']))).size !== rights.length
  ))) throw new Error('Матрица прав должна содержать ' + users + ' пользователей, два отдела и одну группу с уровнями доступа.');
}

export function passport(plan, state) {
  const lines = [
    '# ' + plan.title, '',
    plan.description, '',
    'Аудитория — ' + (plan.audience ?? 'мастера смен, операторы и инженеры') + '.',
    'Обновлено ' + new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'long' }).format(new Date()) + '.',
  ];
  if (state.objects.space?.url) lines.push('[Пространство](' + state.objects.space.url + ')');
  lines.push('', '| Ключ | Родитель | Статья | Статус | Проверка |', '|---|---|---|---|---|');
  for (const item of plan.pages) {
    const entry = state.objects[item.key];
    const article = entry?.url ? '[' + item.title + '](' + entry.url + ')' : item.title;
    const missing = Object.entries(entry?.checks ?? {}).filter(([, confirmed]) => !confirmed).map(([key]) => key);
    const issues = [...(entry?.issues ?? []), ...missing].join(', ').replace(/[|\n]/gu, ' ');
    lines.push('| ' + [item.key, item.key === 'ROOT' ? 'Пространство' : item.parent ?? 'ROOT', article,
      entry?.status ?? 'запланировано', issues || (entry?.checks ? 'подтверждено' : 'ожидает проверки')].join(' | ') + ' |');
  }
  if (state.cards) {
    lines.push('', 'Карточки с обложками на корневой — ' + (state.cards.withCover ?? 0) + ' из ' + (state.cards.expected ?? 5) + '.');
    if (state.cards.directLinks) lines.push('Проверенные ссылки на разделы — ' + state.cards.directLinks + '.');
    if (state.cards.savedLinks) lines.push('Сохранённые переходы на разделы — ' + state.cards.savedLinks + '.');
    if (state.cards.reason) lines.push('Навигация — ' + state.cards.reason + '.');
  }
  if (state.superCards) lines.push('Карточки с обложками на суперстатье — ' + (state.superCards.withCover ?? 0) + ' из ' + (state.superCards.expected ?? 3) + '.');
  if (state.modules) lines.push('Модули — ' + state.modules.join(', ') + '.');
  if (state.glossary) lines.push('Глоссарий — ' + state.glossary.join(', ') + '.');
  lines.push('', 'Доступ — ' + (state.rights?.status ?? (plan.rights.length ? 'запланировано' : 'ожидает матрицу')) + '.');
  if (state.rights?.inheritance) lines.push('Наследование — ' + state.rights.inheritance + '.');
  if (state.rights?.assignments?.length) {
    const types = { user: 'Пользователь', department: 'Отдел', group: 'Группа' };
    lines.push('', '| Тип | Субъект | Уровень |', '|---|---|---|');
    for (const { type, name, level } of state.rights.assignments) {
      lines.push('| ' + [types[type], name, level].map(value => value.replace(/[|\n]/gu, ' ')).join(' | ') + ' |');
    }
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const started = Date.now();
  const { values, positionals: [mode, extra, action, trailing] } = parseArgs({
    allowPositionals: true,
    options: {
      title: { type: 'string' }, sales: { type: 'boolean' }, learning: { type: 'boolean' }, covers: { type: 'string' }, plan: { type: 'string' },
      profile: { type: 'string' }, state: { type: 'string' }, rights: { type: 'string' }, 'stop-after': { type: 'string' },
      'resume-verification': { type: 'boolean' },
      'resume-root': { type: 'string' }, 'resume-section': { type: 'string' },
      content: { type: 'string' }, articles: { type: 'string' }, tables: { type: 'string' }, course: { type: 'string' },
      cli: { type: 'string' }, session: { type: 'string' }, report: { type: 'string' },
    },
  });
  if (mode === 'superarticle-children-code') {
    if (!extra || trailing || !['preview', 'apply', 'verify'].includes(action)) {
      throw new Error('Запуск: node teamly-space-pilot.mjs superarticle-children-code <план.json> <preview|apply|verify>');
    }
    const content = await readChildArticles(extra);
    process.stdout.write('async (page) => (' + runChildArticles.toString() + ')(page, ' + JSON.stringify(content) + ', ' +
      JSON.stringify(action) + ', (' + childArticleLayout.toString() + '))\n');
    return;
  }
  if (mode === 'superarticle-code') {
    if (!extra || trailing || !['preview', 'apply', 'verify'].includes(action)) {
      throw new Error('Запуск: node teamly-space-pilot.mjs superarticle-code <план.json> <preview|apply|verify>');
    }
    const content = await readSuperarticlePlan(extra);
    process.stdout.write('async (page) => (' + runSuperarticle.toString() + ')(page, ' + JSON.stringify(content) + ', ' +
      JSON.stringify(action) + ', (' + superarticleLayout.toString() + '))\n');
    return;
  }
  if ((extra && !['articles-code', 'tables-code', 'course-code'].includes(mode)) ||
      !['check', 'preview', 'preview-code', 'apply', 'apply-code', 'build', 'articles-code', 'tables-code', 'course-code'].includes(mode)) {
    throw new Error('Запуск: node teamly-space-pilot.mjs build --plan план.json --covers каталог --content наполнение.json --articles статьи.json --tables таблицы.json --course курс.json [--session teamly-pilot] [--report замер.json]');
  }
  if (mode === 'build' && ![values.content, values.articles, values.tables, values.course].every(Boolean)) {
    throw new Error('Для полной сборки заполните параметры --content, --articles, --tables и --course.');
  }
  if (values.content && !['check', 'preview-code', 'apply-code', 'build'].includes(mode)) {
    throw new Error('Для наполнения используйте build или apply-code.');
  }
  if (mode !== 'apply' && (values['resume-root'] || values['resume-section'])) {
    throw new Error('URL возобновления можно указывать только для apply.');
  }
  if ([values.sales, values.learning, values.plan].filter(Boolean).length > 1) throw new Error('Укажите один профиль.');
  const profilePlan = values.plan ? JSON.parse(await readFile(values.plan, 'utf8')) :
    values.learning ? learning : values.sales ? sales : production;
  const title = values.title?.trim() ?? profilePlan.title;
  const standalone = ['articles-code', 'tables-code', 'course-code'].includes(mode);
  const saved = (values.state && (standalone || ['build', 'apply-code', 'check'].includes(mode)))
    ? await readFile(values.state, 'utf8').then(JSON.parse, error => {
      if (standalone || error.code !== 'ENOENT') throw error;
      return { objects: {}, steps: {} };
    })
    : { objects: {}, steps: {} };
  const legacy = saved.automationVersion !== 2 && (standalone || Boolean(saved.objects?.ROOT?.url));
  const singlePass = Boolean(profilePlan.structureOnly && !legacy);
  const plan = {
    ...profilePlan, title, singlePass,
    ...(singlePass && { modules: Object.keys(moduleIds) }),
    pages: profilePlan.pages.map((item, index) => {
      const slot = singlePass && item.kind !== 'database' && articlePositions[item.key];
      return { ...item, ...(index === 0 && { title }),
        ...(slot && { emoji: slot[1], emojiName: slot[2], emojiFallback: slot[3] }) };
    }),
    rights: values.rights ? JSON.parse(await readFile(values.rights, 'utf8')) :
      (profilePlan.rights ?? []),
    rootCoverArt: rootCoverArt(profilePlan.coverSubtitle ?? 'Стандарты и процессы цеха', title),
  };
  validate(plan);
  const preparedArticles = values.articles ? await readWorkArticles(values.articles, plan) : undefined;
  const preparedTables = values.tables ? await readSmartTables(values.tables, plan) : undefined;
  const fullMedia = plan.singlePass && Boolean(values.content && values.articles && values.tables && values.course);
  const newFullMedia = fullMedia && !saved.objects?.ROOT?.url;
  const preparedCourse = values.course ? await readCourse(values.course, plan, { requireCoverScenes: newFullMedia }) : undefined;
  const courseRunner = (current, course, mode, previous, checkpoint = 'undefined') => '(' + runCourse.toString() + ')(' +
    [current, course, mode, previous, '(' + courseTest.toString() + ')', '(' + courseMaterial.toString() + ')', checkpoint].join(',') + ')';
  const tableRunner = (current, tables, mode, previous = 'undefined') => '(' + runSmartTables.toString() + ')(' +
    [current, tables, mode, '(' + runSmartTableData.toString() + ')', '(' + runSmartTableAdvanced.toString() + ')',
      '(' + smartTableSession.toString() + ')', previous].join(',') + ')';
  if (mode === 'course-code') {
    if (!['preview', 'apply', 'verify'].includes(extra) || action || !values.state || !preparedCourse) {
      throw new Error('Запуск: node teamly-space-pilot.mjs course-code <preview|apply|verify> --plan план.json --state состояние.json --course курс.json');
    }
    const state = saved;
    const bound = bindCourse(preparedCourse, state.objects);
    process.stdout.write('async current => ' +
      courseRunner('current', JSON.stringify(bound), JSON.stringify(extra), JSON.stringify(state.course ?? null)) + '\n');
    return;
  }
  if (mode === 'tables-code') {
    if (!['preview', 'apply', 'verify'].includes(extra) || action || !values.state || !preparedTables) {
      throw new Error('Запуск: node teamly-space-pilot.mjs tables-code <preview|apply|verify> --plan план.json --state состояние.json --tables таблицы.json');
    }
    const state = saved;
    const bound = bindSmartTables(preparedTables, state.objects, plan.host);
    process.stdout.write('async current => ' + tableRunner('current', JSON.stringify(bound), JSON.stringify(extra)) + '\n');
    return;
  }
  if (mode === 'articles-code') {
    if (!['preview', 'apply', 'verify'].includes(extra) || action || !values.state || !preparedArticles) {
      throw new Error('Запуск: node teamly-space-pilot.mjs articles-code <preview|apply|verify> --plan план.json --state состояние.json --articles статьи.json');
    }
    const state = saved;
    const bound = bindWorkArticles(preparedArticles, state.objects);
    process.stdout.write(`async current => {
      const batch = ${runWorkArticleBatch.toString()};
      const article = ${workArticle.toString()};
      const plan = ${JSON.stringify(bound)};
      const mode = ${JSON.stringify(extra)};
      const started = Date.now();
      const pages = await batch(current, plan, mode, article);
      const written = Date.now() - started;
      const verification = mode === 'apply'
        ? await batch(current, plan.filter(item => pages.some(page => page.key === item.key && !page.error)), 'verify', article)
        : [];
      return {ok:[...pages,...verification].every(page=>!page.error), mode, pages, verification,
        writeMs:written, verifyMs:Date.now()-started-written, totalMs:Date.now()-started};
    }\n`);
    return;
  }
  if (preparedArticles && !['check', 'preview-code', 'apply-code', 'build'].includes(mode)) {
    throw new Error('Для рабочих статей используйте build, apply-code или articles-code.');
  }
  if (preparedTables && !['check', 'preview-code', 'apply-code', 'build'].includes(mode)) {
    throw new Error('Для умных таблиц используйте build, apply-code или tables-code.');
  }
  if (preparedCourse && !['check', 'preview-code', 'apply-code', 'build'].includes(mode)) {
    throw new Error('Для курса используйте build, apply-code или course-code.');
  }
  if (plan.coverStyle === 'hr-reference' && !values.covers) {
    throw new Error('Укажите папку с подготовленными обложками через --covers.');
  }
  if (values.covers) {
    for (const item of plan.pages.filter(needsCover)) {
      item.coverFile = resolve(values.covers, item.key + '.png');
      const png = await readFile(item.coverFile);
      if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== 2500 || png.readUInt32BE(20) !== 500) {
        throw new Error('Некорректный PNG обложки: ' + item.coverFile);
      }
    }
    plan.coverProof = Object.fromEntries(['ROOT', 'SUPER'].map(key => [key, {
      crop: resolve(values.covers, '..', key + ' — кроппер.png'),
      header: resolve(values.covers, '..', key + ' — шапка.png'),
      cards: resolve(values.covers, '..', key + ' — карточки.png'),
    }]));
  }
  const preparedContent = values.content ? await readSpaceContent(values.content, plan, { requireRoundedAssets: fullMedia }) : undefined;
  const fullInputs = preparedContent && preparedArticles && preparedTables && preparedCourse;
  const demo = plan.singlePass && fullInputs && ['build', 'check', 'apply-code'].includes(mode)
    ? prepareDemo(plan, preparedArticles, plan.pages.filter(needsCover)) : undefined;
  if (mode === 'check') return { ok: true, title: plan.title, pages: plan.pages.length,
    articles: plan.pages.filter(item => item.kind !== 'database').length,
    covers: plan.pages.filter(needsCover).length, rights: plan.rights.length, ...(preparedContent && { contentPages: 4 }),
    ...(preparedArticles && { workArticles: preparedArticles.articles.length }), ...(preparedTables && { tables: preparedTables.length }),
    ...(plan.singlePass && preparedTables && { tableRows: Object.fromEntries(preparedTables.map(table => [table.key, table.rows.length])) }),
    ...(preparedCourse && { course: { materials: preparedCourse.materials.length, tests: preparedCourse.materials.length * 2 } }),
    ...(demo && { demo: { aiSection: demo.aiSearch.section, aiSources: demo.aiSearch.sources,
      aiQueries: demo.aiSearch.steps.length, aiSynonyms: demo.aiSearch.synonyms.length, imagesIndex: demo.images.index } }) };
  if (mode === 'preview-code') {
    process.stdout.write('async (page) => { const moduleIds = ' + JSON.stringify(moduleIds) + '; const needsCover = ' + needsCover.toString() +
      '; const probe = await page.context().newPage(); try { return await (' +
      runSpacePilot.toString() + ')(probe, ' + JSON.stringify(plan) + '); } finally { await probe.close(); } }\n');
    return;
  }
  if (mode === 'apply-code' || mode === 'build') {
    if (!plan.structureOnly) throw new Error('Для apply-code нужен профиль полного дерева.');
    const journalKey = values.sales && title === sales.title ? 'codex:teamly-sales:v1' : 'codex:teamly-space:' +
      createHash('sha256').update(plan.host + '/' + title).digest('hex').slice(0, 16);
    const journalPlan = createHash('sha256').update(JSON.stringify(
      plan.pages.map(({ key, parent, title, kind }) => [key, parent, title, kind]),
    )).digest('hex');
    const contentFingerprint = preparedContent && createHash('sha256').update(JSON.stringify(preparedContent)).digest('hex');
    const articlesFingerprint = preparedArticles && createHash('sha256').update(JSON.stringify(preparedArticles)).digest('hex');
    const tablesFingerprint = preparedTables && createHash('sha256').update(JSON.stringify(preparedTables)).digest('hex');
    const courseFingerprint = preparedCourse && createHash('sha256').update(JSON.stringify(preparedCourse)).digest('hex');
    const script = `async current => {
      const needsCover = ${needsCover.toString()};
      const moduleIds = ${JSON.stringify(moduleIds)};
      const plan = ${JSON.stringify(plan)};
      const key = ${JSON.stringify(journalKey)};
      const journalPlan = ${JSON.stringify(journalPlan)};
      const prepared = ${JSON.stringify(preparedContent)};
      const contentFingerprint = ${JSON.stringify(contentFingerprint)};
      const articlesFingerprint = ${JSON.stringify(articlesFingerprint)};
      const tablesFingerprint = ${JSON.stringify(tablesFingerprint)};
      const courseFingerprint = ${JSON.stringify(courseFingerprint)};
      const runSpacePilot = ${runSpacePilot.toString()};
      const content = ${preparedContent ? `(${spaceContentHandlers.toString()})(current, prepared,
        (${runSuperarticle.toString()}), (${runChildArticles.toString()}),
        (${superarticleLayout.toString()}), (${childArticleLayout.toString()}), (${missingGlossaryTerms.toString()}))` : 'undefined'};
      const articles = ${preparedArticles ? `(${workArticleHandlers.toString()})(current,${JSON.stringify(preparedArticles)},
        (${bindWorkArticles.toString()}),(${runWorkArticleBatch.toString()}),(${workArticle.toString()}))` : 'undefined'};
      const tables = ${preparedTables ? `(objects, mode = 'apply', previous) => ${tableRunner('current',
        '(' + bindSmartTables.toString() + ')(' + JSON.stringify(preparedTables) + ',objects,plan.host)', 'mode', 'previous')}` : 'undefined'};
      const course = ${preparedCourse ? `(objects, previous, mode = 'apply', checkpoint) => ${courseRunner('current',
        '(' + bindCourse.toString() + ')(' + JSON.stringify(preparedCourse) + ',objects)', 'mode', 'previous', 'checkpoint')}` : 'undefined'};
      const begin = Date.now();
      let page;
      for (const tab of current.context().pages()) {
        if (new URL(tab.url()).origin !== plan.host) continue;
        if (await tab.evaluate(key => sessionStorage.getItem(key) !== null, key)) { page = tab; break; }
      }
      if (!page) {
        page = await current.context().newPage();
        await page.goto(plan.host + '/space/list/all', { waitUntil: 'domcontentloaded' });
      }
      const state = await page.evaluate(({key,saved}) => {
        const candidates = [localStorage.getItem(key), sessionStorage.getItem(key)].filter(Boolean).map(value => JSON.parse(value));
        candidates.push(saved);
        return candidates.sort((a,b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0];
      }, {key,saved:${JSON.stringify(saved)}});
      if (state.journalPlan && state.journalPlan !== journalPlan) throw new Error('Дерево плана изменилось. Для возобновления используйте исходный план.');
      if (state.contentFingerprint && state.contentFingerprint !== contentFingerprint) throw new Error('План наполнения изменился. Возобновите с исходным планом.');
      if (state.articlesFingerprint && state.articlesFingerprint !== articlesFingerprint) throw new Error('План рабочих статей изменился. Возобновите с исходным планом.');
      if (state.tablesFingerprint && state.tablesFingerprint !== tablesFingerprint) throw new Error('План таблиц изменился. Возобновите с исходным планом.');
      if (courseFingerprint && state.courseFingerprint && state.courseFingerprint !== courseFingerprint) {
        throw new Error('План курса изменился. Возобновите с исходным планом.');
      }
      state.journalPlan = journalPlan;
      if (plan.singlePass) state.automationVersion = 2;
      state.contentFingerprint = contentFingerprint;
      state.articlesFingerprint = articlesFingerprint;
      state.tablesFingerprint = tablesFingerprint;
      if (courseFingerprint) state.courseFingerprint = courseFingerprint;
      let journalWrites = Promise.resolve();
      const save = () => {
        state.savedAt = Date.now();
        const value = JSON.stringify(state);
        journalWrites = journalWrites.catch(() => {}).then(() => page.evaluate(({key,value}) => {
          localStorage.setItem(key, value);
          sessionStorage.setItem(key, value);
        }, {key,value}));
        return journalWrites;
      };
      const attempts = [];
      try {
        const limit = plan.singlePass || plan.fullSpace ? 3 : 1;
        for (let index = 0; index < limit; index++) {
          try {
            const result = await runSpacePilot(page, plan, {
              apply:true,state,save,content,articles,tables,course,stopAfter:${JSON.stringify(values['stop-after'])},
              resumeVerification:${Boolean(values['resume-verification'])} || index > 0,
            });
            attempts.push({ ok: result.ok, complete: result.complete, timingsMs: result.timingsMs });
            if (result.complete || result.mode !== 'apply' || index + 1 === limit) {
              return { ...result, attempts, machineState: state,
                browserMs: Date.now() - begin };
            }
          } catch (error) {
            let problem;
            try { problem = JSON.parse(error.message); } catch { problem = { reason: error.message }; }
            const { stage, reason, timingsMs } = problem;
            const table = stage === 'итоговая проверка умных таблиц' ? state.tableContent :
              stage === 'наполнение умных таблиц' ? state.tableWrite : undefined;
            const details = table && [...table.rows.flatMap(row => row.errors.map(error => row.key + ' / ' + error)),
              ...(table.extras?.errors ?? [])];
            attempts.push({ ok: false, stage, reason, timingsMs, ...(details?.length && { details }) });
            const unresolvedCreate = Object.entries(state.steps).some(([step, status]) =>
              step.endsWith(':create') && status === 'pending' && !state.objects[step.split(':')[0]]?.url);
            const recoverable = state.objects.ROOT?.url || state.steps['space:create'] === 'pending';
            if (index + 1 === limit || !recoverable || (!plan.singlePass && unresolvedCreate)) throw error;
          }
        }
      }
      catch(error) {
        return {ok:false,reason:error.message,url:page.url(),state,attempts,browserMs:Date.now() - begin};
      }
    }\n`;
    if (mode === 'apply-code') {
      process.stdout.write(script);
      return;
    }
    const inputDir = values.plan ? dirname(resolve(values.plan)) : resolve(title.replace(/[\\/]/gu, '／'));
    const jsonReport = resolve(values.report ?? join(inputDir, 'Отчёт о сборке.json'));
    const markdownReport = jsonReport.replace(/\.json$/iu, '') + '.md';
    const inputs = [values.plan, values.content, values.articles, values.tables, values.course, values.rights, values.state]
      .filter(Boolean).map(path => resolve(path));
    if (inputs.includes(jsonReport) || inputs.includes(markdownReport)) {
      throw new Error('Путь отчёта должен отличаться от путей входных файлов и файла состояния.');
    }
    await mkdir(dirname(jsonReport), { recursive: true });
    const temp = await mkdtemp(join(tmpdir(), 'teamly-space-'));
    try {
      const filename = join(temp, 'build.js');
      await writeFile(filename, script);
      const preflightMs = Date.now() - started;
      const cliStarted = Date.now();
      let result;
      try {
        const cliArgs = ['-s=' + (values.session ?? 'teamly-pilot'), '--json', 'run-code', '--filename=' + filename];
        const require = createRequire(import.meta.url);
        const packagePath = values.cli ? undefined : require.resolve('@playwright/cli/package.json');
        const command = values.cli ?? process.execPath;
        const args = packagePath ? [resolve(dirname(packagePath), require(packagePath).bin['playwright-cli']), ...cliArgs] : cliArgs;
        const execution = await promisify(execFile)(command, args, { maxBuffer: 4 * 1024 * 1024 }).catch(error => {
          if (error.stdout?.trim()) return { stdout: error.stdout };
          throw error;
        });
        const raw = JSON.parse(execution.stdout);
        result = raw.result ? JSON.parse(raw.result) : { ok: false, reason: raw.error ?? 'Playwright CLI не вернул результат.' };
      } catch (error) {
        result = { ok: false, reason: error.message.split('\n')[0] };
      }
      const report = {
        ...result, ok: Boolean(result.ok && (result.complete || result.mode === 'checkpoint')),
        preflightMs, cliMs: Date.now() - cliStarted, elapsedMs: Date.now() - started,
        reportFiles: { markdown: markdownReport, json: jsonReport },
        ...(demo && { demo }),
      };
      report.timing = timingSummary(report);
      report.elapsed = duration(report.elapsedMs);
      for (const [path, contents] of [
        [markdownReport, demoReport({ plan, run: report, demo, work: preparedArticles, content: preparedContent, tables: preparedTables, course: preparedCourse })],
        [jsonReport, JSON.stringify(report, null, 2) + '\n'],
      ]) {
        const temporary = path + '.' + process.pid + '.tmp';
        await writeFile(temporary, contents, { mode: 0o600 });
        await rename(temporary, path);
      }
      const checkpoint = result.machineState ?? result.state;
      if (values.state && checkpoint) {
        await mkdir(dirname(resolve(values.state)), { recursive: true });
        const temporary = values.state + '.' + process.pid + '.tmp';
        await writeFile(temporary, JSON.stringify(checkpoint, null, 2) + '\n', { mode: 0o600 });
        await rename(temporary, values.state);
      }
      return report;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  if (plan.structureOnly) throw new Error('Для профиля «Продажи» используйте preview-code или apply-code с playwright-cli run-code.');

  const home = dirname(fileURLToPath(import.meta.url));
  const profile = resolve(values.profile ?? join(home, '.teamly-space-pilot-profile'));
  const folder = title === production.title ? title : 'Teamly — ' + title.replace(/[\\/]/gu, '／');
  const statePath = resolve(values.state ?? join(home, folder, 'Состояние.json'));
  const passportPath = join(dirname(statePath), 'Паспорт.md');
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', viewport: { width: 1520, height: 980 } });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    const checkLogin = async () => {
      const ready = page.locator('.space-list-page__action.create button:visible');
      if (await ready.isVisible()) return;
      await page.goto(plan.host + '/space/list/all', { waitUntil: 'domcontentloaded' });
      const credentialForm = page.locator('input[type="password"]');
      await ready.or(credentialForm).first().waitFor({ timeout: 20000 });
      if (await credentialForm.isVisible()) {
        process.stderr.write('Войдите в Teamly в открытом окне Chrome.\n');
        await ready.waitFor({ timeout: 300000 });
      }
    };
    if (mode === 'preview') {
      await checkLogin();
      return await runSpacePilot(page, plan);
    }

    const fingerprint = createHash('sha256').update(JSON.stringify({ ...plan, rights: [] })).digest('hex');
    return await withJournal(statePath, fingerprint, true, async (state, saveJournal) => {
      async function writePassport() {
        const temporary = passportPath + '.tmp';
        await writeFile(temporary, passport(plan, state), { mode: 0o600 });
        await rename(temporary, passportPath);
      }
      async function save({ report = false } = {}) {
        await saveJournal();
        if (report) await writePassport();
      }
      if (!state.objects.ROOT || new URL(page.url()).origin !== plan.host) await checkLogin();
      for (const [key, raw] of [['ROOT', values['resume-root']], values['resume-section']?.split('=') ?? []]) {
        if (!raw) continue;
        const operation = key === 'ROOT' ? 'space:create' : key + ':create';
        const url = new URL(raw);
        if (!plan.pages.some(item => item.key === key) ||
            state.steps[operation] !== 'pending' || state.objects[key]?.url ||
            url.origin !== plan.host || !/^\/at\/[a-f0-9-]{36}$/iu.test(url.pathname)) {
          throw new Error('Для возобновления нужен URL из боковой панели и незавершённый шаг в том же журнале.');
        }
        state.objects[key] = { url: url.origin + url.pathname, status: 'восстановлено' };
      }
      await save({ report: true });
      try {
        return await runSpacePilot(page, plan, { apply: true, state, save, resumeVerification: values['resume-verification'] });
      } finally {
        await writePassport();
      }
    });
  } finally {
    await context.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    if (result) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (!result.ok) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
