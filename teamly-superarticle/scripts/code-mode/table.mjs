import { button, go, normalized, poll, text, unique, visible } from './browser.mjs';
import { ensureStep } from './journal.mjs';
import { requireValue } from './plan.mjs';

const titleField = page => visible(page.locator([
  '[data-test-id="database-title"]:is(input,textarea,[contenteditable])',
  '[data-test-id="database-title"] :is(input,textarea,[contenteditable])'
].join(',')));
const headers = page => visible(page.locator('[role="columnheader"], .table-header__column, .table-header__cell'));
const rows = page => visible(page.locator('[role="row"]:has([role="gridcell"]), .table-content .row, .table-body .row, .table-body .table-row'));

function titleValue(field) {
  return field.evaluate(element => element.value ?? element.innerText);
}

async function dismiss(page) {
  const overlay = visible(page.locator('.horizontal-rendered__overlay, .database-stretchable-popup__overlay'));
  if (await overlay.count() === 1) await overlay.click({ position: { x: 5, y: 5 } });
  else await page.keyboard.press('Escape');
}

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function column(page, field) {
  return headers(page).filter({ hasText: new RegExp('^\\s*' + escapeRegex(field) + '\\s*$') });
}

async function inspectField(page, field) {
  const header = column(page, field.name);
  requireValue(await header.count() <= 1, 'Повторяется имя столбца «' + field.name + '».');
  if (!await header.count()) return false;
  const active = await unique(header, 'столбец ' + field.name);
  const label = text(active, field.name);
  await (await label.count() === 1 ? label : active).click();
  const menu = visible(page.getByRole('textbox', { name: 'название поля', exact: true }));
  if (!await poll(() => menu.count(), 1800)) {
    await dismiss(page);
    throw new Error('Настройки столбца «' + field.name + '» не открылись.');
  }
  const optionsReady = (await Promise.all((field.options ?? []).map(option =>
    text(page.locator('.database-select-params'), option).count()))).every(Boolean);
  const declared = await header.getAttribute('data-property-type') ?? await header.getAttribute('data-type');
  const isSelect = await visible(page.locator('.database-select-params')).count() === 1;
  const isNumber = await button(page, 'Формат числа').count() === 1;
  if (declared === field.type || (field.type === 'Выбор' && isSelect) || (field.type === 'Число' && isNumber)) {
    await dismiss(page);
    return optionsReady;
  }
  await (await unique(button(page, 'Тип поля'), 'тип столбца ' + field.name)).click();
  const current = visible(page.locator('[aria-selected="true"], [aria-checked="true"], [data-selected="true"], button:has(use[href="#icon-check"]), button:has(use[href="#icon-checkmark"])'));
  const chosen = await current.evaluateAll(elements => elements.map(element => element.innerText.trim()).filter(Boolean));
  await dismiss(page);
  if (await menu.count()) await dismiss(page);
  requireValue(chosen.includes(field.type), 'Тип столбца «' + field.name + '» не подтверждён в интерфейсе.');
  return true;
}

async function addField(page, field) {
  const add = visible(page.locator('button.table-header__add-property, .table-header__add-property[role="button"]'));
  const existing = column(page, field.name);
  if (await existing.count() === 1) {
    requireValue(field.type === 'Выбор' && field.options?.length, 'Существующий столбец требует проверки типа.');
    await existing.click();
    await unique(visible(page.locator('.database-select-params')), 'настройки вариантов существующего поля');
  } else {
    await (await unique(add, 'добавление свойства')).click();
    await (await unique(button(page, field.type), 'тип поля ' + field.type)).click();
    const name = await unique(visible(page.getByRole('textbox', { name: 'название поля', exact: true })), 'название поля');
    await name.fill(field.name);
    await name.press('Tab');
  }
  if (field.type === 'Число') {
    const format = button(page, 'Формат числа');
    if (await format.count() === 1) {
      await format.click();
      await (await unique(button(page, 'Без форматирования'), 'формат числа')).click();
    }
  }
  if (field.options?.length) {
    const panel = visible(page.locator('.database-select-params'));
    for (const option of field.options) {
      if (await text(panel, option).count()) continue;
      const input = visible(panel.locator('input.has-counter, [contenteditable="true"]'));
      if (!await input.count()) await (await unique(visible(panel.locator('.database-select-params__header-button')), 'добавление варианта')).click();
      const control = await unique(input, 'название варианта выбора');
      await control.fill(option);
      await control.press('Enter');
      requireValue(await poll(() => text(panel, option).count(), 1700), 'Вариант не сохранён: ' + option);
    }
  }
  await dismiss(page);
  requireValue(await poll(async () => await column(page, field.name).count() === 1), 'Свойство не появилось в таблице.');
}

function dataRow(page, title) {
  const named = page.locator('[aria-colindex="1"], .row__cell:first-child, .database-title, [data-test-id="database-row-title"]')
    .filter({ hasText: new RegExp('^\\s*' + escapeRegex(title) + '\\s*$') });
  return rows(page).filter({ has: named });
}

async function findRow(page, title) {
  const row = dataRow(page, title);
  requireValue(await row.count() <= 1, 'В таблице несколько строк с именем «' + title + '».');
  return await row.count() === 1;
}

async function addRow(page, row) {
  const create = button(page, 'Кликните, чтобы добавить строку');
  const opener = await create.count() === 1 ? create : await unique(button(page, 'Новая строка'), 'добавление строки');
  await opener.click();
  await (await unique(visible(page.locator('.database-contenteditable.block-creation__element')), 'название строки')).fill(row.title);
  await (await unique(button(page, 'Добавить'), 'сохранение строки')).click();
  requireValue(await poll(() => findRow(page, row.title)), 'Строка не появилась после сохранения.');
}

async function cell(page, title, field) {
  const header = column(page, field);
  requireValue(await header.count() === 1, 'Столбец «' + field + '» отсутствует в текущем представлении или неоднозначен.');
  const id = await header.evaluate(element => ({
    id: element.getAttribute('data-property-id') ?? element.getAttribute('data-column-id'),
    index: element.getAttribute('aria-colindex')
  }));
  const row = dataRow(page, title);
  requireValue(await row.count() === 1, 'Строка «' + title + '» отсутствует в текущем представлении или неоднозначна.');
  if (!id.id && !id.index) {
    const position = await header.evaluate(element => {
      const group = element.closest('.table-header') ?? element.parentElement;
      const columns = [...group.querySelectorAll('.table-header__column, .table-header__cell, [role="columnheader"]')];
      return { index: columns.indexOf(element), count: columns.length };
    });
    const headerIndex = position.index;
    const headerCount = position.count;
    const cells = row.locator('.row__cell, [role="gridcell"]');
    requireValue(await cells.count() === headerCount && headerIndex >= 0,
      'Интерфейс не связал ячейку с полем «' + field + '». Укажите точный селектор отдельным UI-шагом.');
    return cells.nth(headerIndex);
  }
  const target = row.locator(id.id ? '[data-property-id=' + JSON.stringify(id.id) + '], [data-column-id=' + JSON.stringify(id.id) + ']' :
    '[aria-colindex=' + JSON.stringify(id.index) + ']');
  const located = visible(target);
  requireValue(await located.count() === 1, 'Ячейка «' + title + ' / ' + field + '» не определилась однозначно.');
  return located;
}

function cellValue(value) {
  return value && typeof value === 'object'
    ? { input: value.input, display: value.display }
    : { input: value, display: String(value) };
}

async function fillCell(page, target, type, value) {
  const empty = visible(target.locator('.cell-empty__placeholder-icon'));
  await (await empty.count() === 1 ? empty : target).click();
  if (type === 'Число' || type === 'Текст') {
    const editor = type === 'Число' ? visible(page.getByRole('spinbutton')) :
      visible(target.locator('input, textarea, [contenteditable="true"]'));
    const input = await unique(editor, 'редактор ячейки');
    await input.fill(String(value));
    await input.press('Enter');
  } else if (type === 'Дата') {
    await (await unique(button(page, value), 'дата «' + value + '» в открытом календаре')).click();
    await dismiss(page);
  } else {
    const popup = visible(page.locator('[role="listbox"], .database-stretchable-popup, .v-popper__popper--shown'));
    const option = text(popup, value);
    await (await unique(option, 'вариант «' + value + '» в меню ячейки')).click();
    await dismiss(page);
  }
}

export async function writeTable(page, item, object, { origin, state, save, retry }) {
  await go(page, object.href, origin);
  await headers(page).first().waitFor({ timeout: 7500 });
  const field = await unique(titleField(page), 'заголовок умной таблицы');
  if (normalized(await titleValue(field)) !== normalized(item.title)) {
    requireValue(object.created, 'Название существующей ТБД отличается от плана.');
    await field.fill(item.title);
    await field.press('Tab');
    requireValue(await poll(async () => normalized(await titleValue(field)) === normalized(item.title)), 'Название ТБД не установлено.');
  }
  const pending = [];
  const attempt = async (key, find, action) => {
    try {
      await ensureStep(state, save, key, find, action, retry);
    } catch (error) {
      pending.push({ step: key, reason: error.message.split('\n')[0] });
      await dismiss(page).catch(() => {});
    }
  };
  const unavailable = new Set();
  for (const field of item.fields ?? []) {
    const key = item.key + ':field:' + field.name;
    const previous = pending.length;
    await attempt(key, () => inspectField(page, field), () => addField(page, field));
    if (pending.length !== previous) unavailable.add(field.name);
  }
  for (const row of item.rows ?? []) {
    const key = item.key + ':row:' + row.title;
    const previous = pending.length;
    await attempt(key, () => findRow(page, row.title), () => addRow(page, row));
    if (pending.length !== previous) continue;
    for (const [field, value] of Object.entries(row.cells ?? {})) {
      if (unavailable.has(field)) continue;
      const type = item.fields.find(candidate => candidate.name === field).type;
      const { input, display } = cellValue(value);
      const target = () => cell(page, row.title, field);
      const read = async () => normalized(await (await target()).innerText()) === normalized(display);
      await attempt(key + ':' + field, read, async () => {
        const editable = await target();
        requireValue(await editable.locator('.cell-empty').count() || !normalized(await editable.innerText()),
          'В существующей ячейке уже есть другое значение.');
        await fillCell(page, editable, type, input);
        requireValue(await poll(read, 3200), 'Значение не подтвердилось после сохранения.');
      });
    }
  }
  return pending;
}

export async function verifyTable(page, item, href, origin) {
  await go(page, href, origin);
  await headers(page).first().waitFor({ timeout: 7500 });
  const field = await unique(titleField(page), 'название ТБД');
  const correctTitle = Boolean(await poll(async () => normalized(await titleValue(field)) === normalized(item.title), 2500));
  const missing = [];
  for (const field of item.fields ?? []) {
    try {
      if (!await inspectField(page, field)) missing.push('свойство «' + field.name + '»');
    } catch (error) {
      missing.push(error.message.split('\n')[0]);
    }
  }
  for (const row of item.rows ?? []) {
    if (!await findRow(page, row.title)) {
      missing.push('строка «' + row.title + '»');
      continue;
    }
    for (const [name, value] of Object.entries(row.cells ?? {})) {
      try {
        const target = await cell(page, row.title, name);
        if (normalized(await target.innerText()) !== normalized(cellValue(value).display)) missing.push(row.title + ' / ' + name);
      } catch (error) {
        missing.push(error.message.split('\n')[0]);
      }
    }
  }
  return { correctTitle, missing };
}
