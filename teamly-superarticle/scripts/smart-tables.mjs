import { readFile } from 'node:fs/promises';

const propertySymbol = /^[\p{S}\p{P}]/u;
const optionSymbols = ['◈', '●', '▲', '■', '✦', '◆', '◉', '▰'];

function labelProperties(tables) {
  const names = new Map(tables.map(table => [table.key, new Map(table.fields.map(({ name }, index) => [
    name, propertySymbol.test(name) ? name : optionSymbols[index % optionSymbols.length] + ' ' + name,
  ]))]));
  const label = (key, name) => names.get(key)?.get(name) ?? name;
  return tables.map(table => {
    const property = name => label(table.key, name);
    const namedFields = new Map(table.fields.map(field => [field.name, field]));
    return {
      ...table,
      fields: table.fields.map(field => ({
        ...field,
        name: property(field.name),
        ...(field.type === 'Формула' && { field: property(field.field) }),
        ...(field.type === 'Роллап' && {
          relation: property(field.relation),
          field: label(namedFields.get(field.relation)?.target, field.field),
        }),
      })),
      rows: table.rows.map(record => ({
        ...record, cells: Object.fromEntries(Object.entries(record.cells).map(([name, value]) => [property(name), value])),
      })),
      views: table.views?.map(view => ({
        ...view,
        ...Object.fromEntries(['group', 'secondaryGroup', 'date', 'color'].filter(key => view[key]).map(key => [key, property(view[key])])),
        ...(view.properties && { properties: view.properties.map(property) }),
        ...(view.pinned && { pinned: view.pinned.map(property) }),
        ...(view.widths && { widths: Object.fromEntries(Object.entries(view.widths).map(([name, width]) => [property(name), width])) }),
        ...(view.format && { format: { ...view.format, property: property(view.format.property) } }),
        ...(view.chart && { chart: { ...view.chart, category: property(view.chart.category), measure: property(view.chart.measure) } }),
      })),
    };
  });
}

function labelOptions(table) {
  const labels = new Map();
  const fields = table.fields.map(field => {
    const defaults = field.type === 'Статус' ? [
      ['Не в работе', '○ Не в работе'], ['В работе', '◐ В работе'], ['Завершено', '● Завершено'],
    ] : [];
    if (!defaults.length && (!['Выбор', 'Множественный выбор'].includes(field.type) || !field.options?.length)) return field;
    const tags = field.type === 'Множественный выбор';
    const variants = field.options ?? [];
    const mapping = new Map(variants.map((option, index) => [
      option,
      tags ? '# ' + option.trim().replace(/^#\s*/u, '') :
        propertySymbol.test(option.trim()) ? option.trim() : optionSymbols[index % optionSymbols.length] + ' ' + option.trim(),
    ]));
    if (new Set(mapping.values()).size !== variants.length || [...mapping.values()].some(label => !/[\p{L}\p{N}]/u.test(label))) {
      throw new Error('Варианты свойства «' + field.name + '» должны иметь разные названия.');
    }
    for (const [name, standard] of defaults) {
      const custom = variants.find(option => option.trim().replace(/^[^\p{L}\p{N}]+/u, '') === name);
      mapping.set(name, custom ? mapping.get(custom) : standard);
    }
    labels.set(field.name, mapping);
    return {
      ...field, options: [...new Set(mapping.values())],
      ...(defaults.length && { renameOptions: defaults.map(([name]) => [name, mapping.get(name)]) }),
    };
  });
  const pick = (name, value) => {
    const mapping = labels.get(name);
    if (!mapping || value == null) return value;
    const convert = option => {
      if (mapping.has(option)) return mapping.get(option);
      if ([...mapping.values()].includes(option)) return option;
      throw new Error('Не задан вариант «' + option + '» свойства «' + name + '».');
    };
    return Array.isArray(value) ? value.map(convert) : convert(value);
  };
  return {
    ...table,
    fields,
    rows: table.rows.map(row => ({
      ...row, cells: Object.fromEntries(Object.entries(row.cells).map(([name, value]) => [name, pick(name, value)])),
    })),
    views: table.views?.map(view => view.format ? {
      ...view, format: { ...view.format, value: pick(view.format.property, view.format.value) },
    } : view),
  };
}

export async function readSmartTables(filename, space) {
  const input = JSON.parse(await readFile(filename, 'utf8'));
  const planned = space.pages.filter(page => page.kind === 'database');
  if (!Array.isArray(input) || input.length !== planned.length ||
      new Set(input.map(table => table.key)).size !== planned.length ||
      planned.some(page => !input.some(table => table.key === page.key))) {
    throw new Error('В плане нужно описать каждую умную таблицу пространства.');
  }
  const tables = space.singlePass ? labelProperties(input) : input;
  const defined = new Map(tables.map(table => [table.key, table.fields]));
  return tables.map(input => {
    const table = space.singlePass ? labelOptions(input) : input;
    const title = planned.find(page => page.key === table.key).title;
    if (space.singlePass && (table.key === 'SUPER-TBD' ? table.rows.length !== 10 : table.rows.length < 5 || table.rows.length > 8)) {
      throw new Error('Таблица «' + title + '» должна содержать ' + (table.key === 'SUPER-TBD' ? 'ровно 10 строк.' : 'от 5 до 8 строк.'));
    }
    const fields = new Map(table.fields.map(field => [field.name, field]));
    const types = new Set(table.fields.map(field => field.type));
    if (fields.size !== table.fields.length || table.fields.some(field => !field.name?.trim() || !field.type?.trim()) ||
        !table.rows.length || new Set(table.rows.map(row => row.title)).size !== table.rows.length ||
        table.rows.some(row => !row.title?.trim() || Object.keys(row.cells).some(name => !fields.has(name)))) {
      throw new Error('Несогласованные свойства или строки таблицы «' + title + '».');
    }
    if (table.key === 'SUPER-TBD') {
      if (!['Выбор','Множественный выбор','Пользователь','Число','Дата','Статус','ID','Формула','Связи','Роллап']
        .every(type => types.has(type)) || table.views?.length < 3 || table.views?.length > 4 ||
        !['Таблица', 'Канбан', 'Календарь'].every(type => table.views?.some(view => view.type === type)) ||
        !table.views.some(view => fields.has(view.group) && fields.has(view.format?.property))) {
        throw new Error('Для журнала нужны все типы, три-четыре вида, группировка и условное форматирование.');
      }
    } else if (table.fields.length < 2 || table.fields.length > 4) {
      throw new Error('Укажите от трёх до пяти свойств таблицы «' + title + '».');
    }
    for (const field of table.fields) {
      if (field.type === 'Связи' && (field.target === table.key || !defined.has(field.target))) {
        throw new Error('Укажите другую таблицу для связи «' + field.name + '».');
      }
      if (space.singlePass && field.type === 'Связи') {
        const names = new Set(tables.find(source => source.key === field.target).rows.map(row => row.title));
        if (table.rows.some(record => !names.has(record.cells[field.name]))) {
          throw new Error('Не найдены связанные строки для «' + field.name + '» таблицы «' + title + '».');
        }
      }
      if (field.type === 'Роллап' && !defined.get(fields.get(field.relation)?.target)
        ?.some(source => source.name === field.field)) throw new Error('Не найдено поле-источник роллапа «' + field.name + '».');
    }
    const viewNames = new Set();
    const knowsProperty = name => name === 'Название' || fields.has(name);
    for (const view of table.views ?? []) {
      if (viewNames.has(view.name) || !view.name?.trim() ||
          view.properties?.some(name => !knowsProperty(name)) ||
          [view.group, view.secondaryGroup, view.date, view.color, view.chart?.category, ...(view.pinned ?? [])]
            .some(name => name && !knowsProperty(name)) ||
          Object.entries(view.widths ?? {}).some(([name, width]) => !knowsProperty(name) || !Number.isInteger(width) || width <= 0) ||
          (view.type === 'Календарь' && view.properties && (view.properties.length < 2 || view.properties.length > 4))) {
        throw new Error('Проверьте настройки представления «' + view.name + '» таблицы «' + title + '».');
      }
      viewNames.add(view.name);
    }
    return { ...table, title, ...(space.singlePass && { exactRowCount: true }) };
  });
}

export function bindSmartTables(tables, objects, host) {
  return tables.map(table => {
    const url = new URL(objects[table.key]?.url);
    if (url.origin !== host || !/^\/db\/[a-f0-9-]{36}$/iu.test(url.pathname) || url.search || url.hash) {
      throw new Error('Некорректный адрес таблицы «' + table.title + '».');
    }
    return { ...table, url: url.href };
  });
}

export async function smartTableSession(page, table) {
  const short = { timeout: 3800 };
  const wait = { timeout: 11000 };
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true }).filter({ visible: true });
  const text = (name, scope = page) => scope.getByText(name, { exact: true }).filter({ visible: true });
  const header = page.locator('.table-header:visible').first();
  const columns = header.locator('.table-header__column');
  const col = name => columns.filter({ has: page.getByText(name, { exact: true }) });
  const rows = page.locator('.row:has(.database-title.row__cell)');
  const row = name => rows.filter({ has: page.locator('.database-title.row__cell').getByText(name, { exact: true })
    .or(page.locator('.database-title.row__cell').and(page.getByText(name, { exact: true }))) });
  const fieldTitle = page.getByRole('textbox', { name: 'название поля', exact: true }).filter({ visible: true });
  const fieldAdd = header.locator('button.table-header__add-property:visible');
  const step = async (label, work) => {
    try { return await work(); }
    catch (error) {
      const [message, ...log] = error.message.split('\n');
      const waiting = log.find(line => line.includes('waiting for locator'))?.trim();
      throw new Error(label + ' — ' + message + (waiting ? ' (' + waiting + ')' : ''));
    }
  };
  if (table.rows.length > 20) {
    await page.setViewportSize({ width: 3000, height: Math.min(5200, 2100 + table.rows.length * 55) });
  } else if (table.exactRowCount) {
    const viewport = page.viewportSize();
    if (viewport && viewport.height < 1200) await page.setViewportSize({ width: viewport.width, height: 1200 });
  }
  if (new URL(page.url()).pathname !== new URL(table.url).pathname) {
    await page.goto(table.url, { ...wait, waitUntil: 'domcontentloaded' });
  }
  await page.locator('.database-header__main').waitFor(wait);
  const tab = page.getByRole('link', { name: 'Таблица', exact: true }).filter({ visible: true });
  await tab.first().waitFor(wait);
  if (await tab.count() === 1 && !await tab.evaluate(el => el.closest('.tabs__item')?.classList.contains('active'))) {
    await tab.click(wait);
  }
  await step('Основное представление', () => page.locator('.tabs__item.active:visible').getByRole('link', {
    name: 'Таблица', exact: true,
  }).waitFor(wait));
  await step('Загрузка столбцов', () => fieldAdd.first().waitFor(wait));
  await page.waitForFunction(expected => {
    const selector = '[data-test-id="database-title"]:is(input,textarea,[contenteditable]), [data-test-id="database-title"] :is(input,textarea,[contenteditable])';
    return [...document.querySelectorAll(selector)].some(element => element.getClientRects().length &&
      (element.value ?? element.innerText).trim() === expected);
  }, table.title, wait);
  if (table.exactRowCount) await step('Загрузка строк', () => rows.filter({ visible: true }).first()
    .or(button('Кликните, чтобы добавить строку')).first().waitFor(wait));
  if (table.rows.length > 20 && await rows.first().waitFor({ timeout: 1200 }).then(() => true, () => false)) {
    let available = await rows.count();
    while (available < table.rows.length) {
      await rows.last().scrollIntoViewIfNeeded(wait);
      await rows.last().hover(wait);
      await page.mouse.wheel(0, 640);
      if (!await rows.nth(available).waitFor({ timeout: 1600 }).then(() => true, () => false)) break;
      available = await rows.count();
    }
  }

  async function dismiss() {
    const overlay = page.locator('.horizontal-rendered__overlay:visible, .database-stretchable-popup__overlay:visible').last();
    if (await overlay.count()) await overlay.click({ ...short, position: { x: 4, y: 4 } });
    else await page.keyboard.press('Escape');
  }

  async function openField(field, create = true) {
    await dismiss();
    const named = col(field.name);
    const count = await named.count();
    if (count > 1) throw new Error('Найдено несколько свойств «' + field.name + '».');
    const ticket = 'codex:teamly-property:' + new URL(table.url).pathname + ':' + field.name;
    const journal = entry => page.evaluate(({ ticket, entry }) => {
      if (entry === undefined) return JSON.parse(localStorage.getItem(ticket) ?? 'null');
      if (entry === null) localStorage.removeItem(ticket);
      else localStorage.setItem(ticket, JSON.stringify(entry));
    }, { ticket, entry });
    const columnCodes = () => columns.evaluateAll(cells => cells.map(cell => cell.dataset.code).filter(Boolean));
    let pending = create && !count ? await journal() : null;
    let target = named;
    if (count === 1) {
      await text(field.name, named).click(wait);
    } else {
      if (!create) throw new Error('Свойство «' + field.name + '» отсутствует.');
      const newField = !pending;
      if (newField) {
        if (table.exactRowCount && await col(field.type).count()) {
          throw new Error('Найдено свойство под временным именем «' + field.type + '». Сначала подтвердите его принадлежность.');
        }
        const before = await columnCodes();
        if (!before.length) throw new Error('Не удалось получить идентификаторы столбцов перед созданием.');
        await fieldAdd.click(wait);
        pending = { before };
        await journal(pending);
        await button(field.type).click(wait);
      }
      if (!pending.code) {
        await page.waitForFunction(before => [...document.querySelectorAll('.table-header__column[data-code]')]
          .some(column => column.getClientRects().length && !before.includes(column.dataset.code)), pending.before, wait);
        const added = (await columnCodes()).filter(code => !pending.before.includes(code));
        if (added.length !== 1) throw new Error('Не удалось однозначно определить новый столбец «' + field.name + '».');
        pending.code = added[0];
        await journal(pending);
      }
      target = columns.and(page.locator('[data-code=' + JSON.stringify(pending.code) + ']'));
      if (!newField) {
        const previous = (await target.innerText(wait)).trim();
        await text(previous, target).click(wait);
      }
    }
    await fieldTitle.waitFor(wait);
    if (await fieldTitle.evaluate(el => (el.value ?? el.innerText).trim()) !== field.name) {
      const acknowledgement = page.waitForResponse(response => {
        const request = response.request();
        return new URL(response.url()).pathname.startsWith('/api/v1/wiki/') &&
          ['POST', 'PUT', 'PATCH'].includes(request.method()) && request.postData()?.includes(field.name);
      }, short).then(response => response.ok(), () => false);
      await fieldTitle.fill(field.name, wait);
      await fieldTitle.press('Tab', wait);
      if (!await acknowledgement) {
        // Отклик мог потеряться. Читаем сохранённое имя прежнего столбца.
        await page.reload({ ...wait, waitUntil: 'domcontentloaded' });
        await text(field.name, target).waitFor(wait);
        await text(field.name, target).click(wait);
        await fieldTitle.waitFor(wait);
      }
    }
    await text(field.name, target).waitFor(wait);
    if (create) await journal(null);
  }

  async function options(field) {
    const settings = page.locator('.database-select-params:visible');
    for (const [name, label] of field.renameOptions ?? []) {
      const original = settings.getByText(name, { exact: true });
      if (!await original.count()) continue;
      await original.click(wait);
      const editor = settings.getByRole('textbox').filter({ visible: true });
      await editor.fill(label, wait);
      await editor.press('Tab', wait);
      const updated = settings.getByText(label, { exact: true });
      await updated.waitFor(wait);
      if (await editor.isVisible()) await updated.click(wait);
    }
    for (const option of field.options ?? []) {
      const existing = settings.getByText(option, { exact: true });
      if (await existing.count()) continue;
      const input = settings.locator('input.has-counter:visible,[contenteditable="true"]:visible');
      if (!await input.count()) await settings.locator('.database-select-params__header-button:visible').click(wait);
      await input.first().fill(option, wait);
      await input.first().press('Enter', wait);
      await existing.first().waitFor(wait);
    }
  }

  async function field(field) {
    if (await col(field.name).count() === 1 && !field.options?.length) return;
    await openField(field);
    if (field.options?.length) await options(field);
    await dismiss();
    await col(field.name).waitFor(wait);
  }

  async function addRow(record) {
    const existing = await row(record.title).count();
    if (existing > 1) throw new Error('В таблице есть несколько строк «' + record.title + '».');
    if (existing === 1) return;
    await dismiss();
    const blank = button('Кликните, чтобы добавить строку');
    const command = await blank.count() ? blank : button('Новая строка');
    await command.click(wait);
    const input = page.locator('.database-contenteditable.block-creation__element:visible');
    await input.fill(record.title, wait);
    await button('Добавить').click(wait);
    await row(record.title).waitFor(wait);
    const cancel = button('Отменить');
    if (await input.count() && await cancel.count() === 1) await cancel.click(short);
  }

  async function cell(record, name) {
    const names = await columns.evaluateAll(list => list.map(el => el.innerText.trim()));
    const index = names.indexOf(name);
    const found = await row(record).count();
    if (index < 0 || found !== 1) {
      throw new Error('Ячейка «' + record + ' / ' + name + '» не найдена однозначно. Видимых строк: ' + found + '.');
    }
    const cells = row(record).locator('.row__cell');
    if (await cells.count() !== names.length) throw new Error('Число ячеек отличается от числа столбцов.');
    return cells.nth(index);
  }

  async function matches(target, type, value) {
    const shown = (await target.innerText(short)).trim();
    if (type === 'Множественный выбор') {
      const selected = await target.locator('.option__text').allTextContents();
      return value.length === selected.length && value.every(tag => selected.includes(tag));
    }
    if (type === 'Дата') {
      const d = new Date(value + 'T12:00:00Z');
      const long = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'UTC' }).format(d);
      return [value.split('-').reverse().join('.'), long, long.replace(/ г\.$/u, '')].includes(shown);
    }
    if (type === 'Число') return shown !== '' && Number(shown.replace(/\s/gu, '').replace(',', '.')) === value;
    if (type === 'Пользователь') {
      const avatar = target.locator('.multiple-person__avatar');
      if (await avatar.count() !== 1) return false;
      await avatar.hover(short);
      return page.getByRole('tooltip', { name: value, exact: true }).first()
        .waitFor({ timeout: 1200 }).then(() => true, () => false);
    }
    return shown === value;
  }

  async function expectValue(record, field, value) {
    const target = await cell(record, field.name);
    const deadline = Date.now() + short.timeout;
    while (!await matches(target, field.type, value)) {
      if (Date.now() >= deadline) {
        throw new Error('Ожидалось ' + JSON.stringify(value) + ', в таблице «' + (await target.innerText(short)).trim() + '».');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async function value(record, field, value, replace = false) {
    await dismiss();
    const target = await cell(record, field.name);
    if (await matches(target, field.type, value)) return;
    const old = (await target.innerText(short)).trim();
    if (old && !replace && field.type !== 'Статус' && field.type !== 'Множественный выбор') {
      throw new Error('В ячейке уже сохранено другое значение: ' + old);
    }
    const empty = target.locator('.cell-empty__placeholder-icon:visible');
    await (await empty.count() ? empty : target).click(wait);
    const popup = page.locator('.database-stretchable-popup__container:visible').last();
    if (field.type === 'Число' || field.type === 'Текст') {
      const input = field.type === 'Число' ? page.getByRole('spinbutton').filter({ visible: true }) :
        page.locator('.database-text-popup [contenteditable]:visible');
      await input.fill(String(value), wait);
      await input.press('Enter', wait);
    } else if (field.type === 'Дата') {
      const date = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric',
        month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z'));
      const day = button(date);
      if (await day.waitFor(short).then(() => true, () => false)) await day.click(wait);
      else {
        const input = page.locator('input[data-range="from"]:visible');
        await input.fill(value.split('-').reverse().join('.'), wait);
        await input.press('Tab', wait);
      }
    } else if (field.type === 'Статус') {
      await text(value, page.locator('.status-popup__options')).click(wait);
    } else if (field.type === 'Множественный выбор') {
      const previous = await target.locator('.option__text').allTextContents();
      for (const tag of value) {
        if (!previous.includes(tag)) await text(tag, popup.getByRole('list')).click(wait);
      }
    } else if (field.type === 'Пользователь') {
      const selected = popup.locator('.person-option:has(button.person-popup__users-action)');
      const picked = name => selected.filter({ hasText: name });
      const existing = (await selected.allInnerTexts()).map(name => name.trim());
      if (!replace && existing.some(name => name !== value)) throw new Error('В ячейке уже есть другой ответственный.');
      if (!existing.includes(value)) {
        await page.locator('#database-person-popup-search:visible').fill(value.split(' ')[0], wait);
        await text(value, popup.getByRole('listitem')).first().click(wait);
        await picked(value).waitFor(wait);
      }
      for (const name of existing.filter(name => name !== value)) {
        await picked(name).locator('button.person-popup__users-action').click(wait);
      }
    } else if (field.type === 'Связи') {
      await text(value, popup).click(wait);
      const saved = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/v1/wiki/properties/command/execute' &&
        response.request().method() === 'POST', wait);
      await page.locator('.database-stretchable-popup__overlay:visible').click({ ...wait, position: { x: 4, y: 4 } });
      if (!(await saved).ok()) throw new Error('Teamly не сохранил связанную запись.');
      await expectValue(record, field, value);
      return;
    } else {
      await text(value, popup.getByRole('listitem')).first().click(wait);
    }
    await dismiss();
    const deadline = Date.now() + short.timeout;
    while (Date.now() < deadline) {
      if (await matches(await cell(record, field.name), field.type, value)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Значение не подтвердилось: ' + (await (await cell(record, field.name)).innerText(short)).trim());
  }

  async function formula(field, records, verify = false) {
    if (!verify) return addFormula(field, records[0].title);
    const values = [];
    for (const record of records) {
      const target = await cell(record.title, field.name);
      const input = record.cells[field.field];
      const shown = await target.innerText(wait);
      const actual = Number(shown.replace(/\s/gu, '').replace(',', '.'));
      if (!shown.trim() || !Number.isFinite(actual) || Math.abs(actual - input / field.divisor) > 0.000001) {
        throw new Error('Не подтверждён результат формулы для «' + record.title + '».');
      }
      values.push(actual);
    }
    return values;
  }

  async function addFormula(field, record) {
    await openFieldOrCreate(field);
    const target = await cell(record, field.name);
    await target.click(wait);
    const content = page.locator('.cm-content:visible');
    await content.waitFor(wait);
    const wanted = '$(' + JSON.stringify(field.field) + ') / ' + field.divisor;
    const expression = (await content.innerText(wait)).trim();
    if (expression === wanted) {
      await dismiss();
      return;
    }
    if (expression) throw new Error('В поле уже настроена другая формула.');
    await page.locator('.formula-popup__options-item')
      .filter({ has: page.getByText(field.field, { exact: true }) }).click(wait);
    await content.press('End');
    await page.keyboard.insertText(' / ' + field.divisor);
    if ((await content.innerText(wait)).trim() !== wanted) throw new Error('Редактор сформировал другое выражение.');
    await button('Применить').click(wait);
    await content.waitFor({ ...wait, state: 'hidden' });
  }

  async function openFieldOrCreate(property) {
    if (!await col(property.name).count()) await field(property);
    await dismiss();
  }

  async function relation(field, source) {
    if (await col(field.name).count() === 1) return;
    await dismiss();
    await fieldAdd.click(wait);
    await button('Связи').click(wait);
    const dialog = page.locator('.binding-create-popup__content:visible');
    await dialog.getByRole('textbox', { name: 'Название свойства', exact: true }).fill(field.name, wait);
    await dialog.locator('.binding-create-popup__source .vs__dropdown-toggle').click(wait);
    await page.getByRole('option', { name: 'Умная таблица', exact: true }).click(wait);
    const target = new URL(source.url).pathname.split('/').at(-1);
    function matchingList(data) {
      if (!data || typeof data !== 'object') return;
      if (Array.isArray(data) && data.some(item => item?.id === target && item.title === source.title)) {
        return data.filter(item => item?.title === source.title).map(item => item.id);
      }
      return Object.values(data).map(matchingList).find(Boolean);
    }
    let ordered;
    const response = page.waitForResponse(async response => {
      if (new URL(response.url()).pathname !== '/api/v1/wiki/ql/spaces' || !response.ok()) return false;
      ordered = matchingList(await response.json().catch(() => null));
      return Boolean(ordered?.length);
    }, wait);
    const picker = dialog.locator('.binding-create-popup__sources');
    await picker.locator('.binding-create-popup__sources-dropdown-button').click(wait);
    await response;
    const candidates = text(source.title, picker);
    await candidates.nth(ordered.length - 1).waitFor(wait);
    if (await candidates.count() !== ordered.length) throw new Error('Список одноимённых источников изменился.');
    await candidates.nth(ordered.indexOf(target)).click(wait);
    await button('Создать', dialog).click(wait);
    await col(field.name).waitFor(wait);
  }

  async function view(item, verify = false) {
    const header = page.locator('.database-header__main');
    const link = header.locator('a.database-header__tabs-item:visible')
      .filter({ has: page.getByText(item.name, { exact: true }) });
    const ticket = 'codex:teamly-view:' + new URL(table.url).pathname + ':' + item.name;
    const known = await page.evaluate(key => localStorage.getItem(key), ticket);
    if (verify || known || item.name === 'Таблица') {
      await link.first().waitFor(wait);
    } else if (!await link.count()) {
      await link.first().waitFor({ timeout: 600 }).catch(error => {
        if (error.name !== 'TimeoutError') throw error;
      });
    }
    if (await link.count() === 0) {
      await dismiss();
      await header.locator('button:has(use[href="#icon-plus"]):visible').click(wait);
      await header.locator('input[placeholder="Введите название"]:visible').fill(item.name, wait);
      await page.evaluate(key => localStorage.setItem(key, 'pending'), ticket);
      await button(item.type === 'Канбан' ? 'Доска' : item.type, header).click(wait);
      await link.first().waitFor(wait);
    }
    if (await link.count() !== 1) throw new Error('Неоднозначная вкладка представления «' + item.name + '».');
    const url = await link.evaluate(a => a.href);
    if (known && known !== 'pending' && known !== url) throw new Error('Изменился идентификатор представления «' + item.name + '».');
    await page.evaluate(({ ticket, url }) => localStorage.setItem(ticket, url), { ticket, url });
    const active = await link.evaluate(a => a.closest('.tabs__item')?.classList.contains('active'));
    if (!active) {
      await link.click(wait);
    }
    const selected = page.locator('.tabs__item.active:visible').getByRole('link', { name: item.name, exact: true });
    await selected.waitFor(wait);
    if (item.type === 'Таблица') await fieldAdd.waitFor(wait);
    return url;
  }

  async function setting(name) {
    await dismiss();
    await page.locator('.header-settings button:has(use[href="#icon-gear"]):visible').click(wait);
    await page.locator('.settings-button').filter({ has: page.getByText(name, { exact: true }) })
      .locator('button.settings-button__button').click(wait);
    await page.getByRole('heading', { name, exact: true }).waitFor(wait);
  }

  async function selectOption(combo, name, verify, reopen) {
    const selected = async () => combo.evaluate(node =>
      node.innerText.replace(/Loading\.\.\.\s*$/u, '').trim() || node.querySelector('input')?.value || '', undefined, short);
    if (await selected() === name) return;
    if (verify) throw new Error('Ожидалось «' + name + '», выбрано «' + await selected() + '».');
    await combo.click(wait);
    const role = page.getByRole('option', { name, exact: true }).filter({ visible: true });
    const option = await role.count() ? role : page.locator('.vs__dropdown-option:visible').getByText(name, { exact: true });
    await option.click(wait);
    const deadline = Date.now() + wait.timeout;
    while (true) {
      if (await combo.isVisible()) {
        if (await selected().catch(() => undefined) === name) return;
      } else if (reopen) {
        await setting(reopen);
      }
      if (Date.now() >= deadline) throw new Error('Настройка «' + name + '» не подтвердилась.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async function visibleProperties(names, type, verify) {
    await setting(type === 'Форма' ? 'Поля' : 'Свойства');
    const options = page.locator('.visible-fields-item__option:visible');
    await Promise.all(names.map(name => options.filter({ has: page.getByText(name, { exact: true }) })
      .first().waitFor(wait).catch(error => {
        if (error.name !== 'TimeoutError') throw error;
        throw new Error('Свойство «' + name + '» не появилось в настройках представления.');
      })));
    const available = await options.locator('p').allInnerTexts();
    if (new Set(available).size !== available.length) {
      throw new Error('В списке свойств повторяются названия: ' + [...new Set(available.filter((name, index) => available.indexOf(name) !== index))].join(', '));
    }
    for (const name of names) {
      if (!available.includes(name)) throw new Error('Свойство «' + name + '» недоступно в представлении.');
    }
    const actual = [];
    for (const name of available) {
      const option = options.filter({ has: page.getByText(name, { exact: true }) });
      const toggle = option.locator('button.visible-fields-item__button');
      const eye = toggle.locator('use');
      const visible = await eye.getAttribute('href') === '#icon-eye';
      const wanted = names.includes(name);
      if (await toggle.isDisabled(wait)) {
        if (wanted && visible) actual.push(name);
        continue;
      }
      if (visible !== wanted) {
        if (verify) throw new Error('Видимость свойства «' + name + '» отличается от плана.');
        await toggle.click(wait);
        const icon = wanted ? '#icon-eye' : '#icon-eye-closed';
        await toggle.locator('use[href="' + icon + '"]').waitFor({ ...wait, state: 'attached' });
      }
      if (wanted) actual.push(name);
    }
    await dismiss();
    return actual;
  }

  async function tableColumns(item, verify) {
    const widths = {};
    for (const [name, desired] of Object.entries(item.widths ?? {})) {
      const column = col(name);
      const width = () => column.evaluate(el => el.getBoundingClientRect().width, undefined, wait);
      const current = await width();
      if (Math.abs(current - desired) > 2) {
        if (verify) throw new Error('Ширина «' + name + '» ' + current + ' вместо ' + desired + ' px.');
        const handle = column.locator('button.header-column__resize');
        await handle.scrollIntoViewIfNeeded(wait);
        const box = await handle.boundingBox(wait);
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        const [saved] = await Promise.all([
          page.waitForResponse(response =>
            new URL(response.url()).pathname === '/api/v1/wiki/properties/command/execute' &&
            response.request().method() === 'POST', wait),
          (async () => {
            await page.mouse.down();
            try { await page.mouse.move(x + desired - current, y, { steps: 8 }); }
            finally { await page.mouse.up(); }
          })(),
        ]);
        if (!saved.ok()) throw new Error('Teamly не сохранил ширину «' + name + '».');
      }
      widths[name] = await width();
      if (Math.abs(widths[name] - desired) > 2) throw new Error('Ширина «' + name + '» не сохранилась.');
    }
    for (const name of item.pinned ?? []) {
      const pinned = col(name).locator('use[href="#icon-pin"]');
      if (await pinned.count()) continue;
      if (verify) throw new Error('Свойство «' + name + '» не закреплено.');
      await openField({ name }, false);
      await button('Закрепить').click(wait);
      await pinned.waitFor({ ...wait, state: 'attached' });
    }
    return widths;
  }

  async function appearance(item, verify = false) {
    const url = await view(item, verify);
    const controls = page.getByRole('combobox', { name: 'Search for option', exact: true });
    if (item.group) {
      await setting('Группировка');
      await selectOption(controls.first(), item.group, verify, 'Группировка');
      await dismiss();
    }
    if (item.secondaryGroup) {
      await setting('Дополнительная группировка');
      await selectOption(controls.first(), item.secondaryGroup, verify, 'Дополнительная группировка');
      await dismiss();
    }
    if (item.format) {
      await setting('Условное форматирование');
      if (!await controls.count() && !verify) await button('Добавить правило').click(wait);
      const rule = page.getByRole('listitem').filter({ has: controls.first() }).last();
      const enabled = rule.getByRole('checkbox');
      if (!await enabled.isChecked(wait)) {
        if (verify) throw new Error('Правило оформления отключено.');
        await enabled.click(wait);
      }
      for (const [index, name] of [item.format.color, item.format.property, item.format.value].entries()) {
        await selectOption(controls.nth(index), name, verify);
      }
      await dismiss();
    }
    if (item.type === 'Календарь' && item.date) {
      await setting('Настройки календаря');
      await selectOption(controls.first(), item.date, verify);
      if (item.color) await selectOption(controls.nth(1), item.color, verify);
      await dismiss();
    }
    if (item.type === 'Гант' && item.date) {
      await setting('Настройки графика');
      await selectOption(controls.first(), item.date, verify);
      if (item.scale) await selectOption(controls.nth(1), item.scale, verify);
      await dismiss();
    }
    if (item.chart) {
      await setting('Настройки диаграммы');
      await selectOption(controls.first(), item.chart.category, verify);
      const measure = controls.nth(1);
      if (!await measure.getByRole('button', { name: 'Deselect ' + item.chart.measure, exact: true }).count()) {
        if (verify) throw new Error('Не подтверждён показатель «' + item.chart.measure + '».');
        await measure.click(wait);
        await page.getByRole('option', { name: item.chart.measure, exact: true }).click(wait);
      }
      await dismiss();
    }
    const properties = item.properties && await visibleProperties(item.properties, item.type, verify);
    const widths = (item.widths || item.pinned) && await tableColumns(item, verify);
    if (!verify) {
      const save = button('Сохранить для всех');
      if (await save.count() === 1) await save.click(wait);
    }
    return { ...item, url, properties, widths };
  }

  async function rollup(field, relationField, records, source, verify = false) {
    await openField(field, !verify);
    const controls = page.locator('.rollup-params:visible .vs__dropdown-toggle');
    await selectOption(controls.nth(0), field.relation, verify);
    await selectOption(controls.nth(1), field.field, verify);
    const trigger = page.locator('.rollup-params__formula-trigger:visible');
    if ((await trigger.innerText(wait)).trim() !== field.calculate) {
      if (verify) throw new Error('Не подтверждён тип вычисления «' + field.calculate + '».');
      await trigger.click(wait);
      const method = text(field.calculate);
      if (!await method.count()) {
        const more = text('Больше вариантов');
        await more.hover(wait);
        if (!await method.count()) await more.click(wait);
      }
      await method.last().click(wait);
      await trigger.getByText(field.calculate, { exact: true }).waitFor(wait);
    }
    await dismiss();
    if (!verify) return;
    const results = [];
    for (const record of records) {
      const sourceRow = source.rows.find(row => row.title === record.cells[relationField.name]);
      const expected = sourceRow?.cells[field.field];
      if (typeof expected !== 'number') throw new Error('Не найдено исходное число для «' + record.title + '».');
      const target = await cell(record.title, field.name);
      await target.getByText(String(expected), { exact: true }).waitFor(wait);
      results.push(expected);
    }
    return results;
  }

  return { button, text, col, row, rows, field, openField, options, addRow, cell, value, matches, expectValue, formula, relation,
    view, appearance, setting, selectOption, rollup,
    dismiss, step, wait, short };
}

export async function runSmartTableData(current, tables, mode, openTable, afterTable, verifiedRows = []) {
  const pending = tables.slice();
  const result = [];
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
    const page = await current.context().newPage();
    try {
      if (afterTable && tables.some(table => table.views?.some(view => view.widths))) {
        await page.setViewportSize({ width: 3000, height: 1200 });
      }
      while (pending.length) {
        const table = pending.shift();
        const verified = verifiedRows.find(row => row.key === table.key);
        const summary = verified ? { ...verified, errors: [] } : { key: table.key, schema: [], records: [], cells: 0, errors: [] };
        result.push(summary);
        try {
          const session = await openTable(page, table);
          if (verified) {
            await afterTable(table, session);
            continue;
          }
          const basic = table.fields.filter(field => !['Связи', 'Роллап', 'Формула'].includes(field.type));
          for (const field of basic) {
            if (mode === 'apply') {
              await session.step(field.name, () => session.field(field));
              summary.schema.push(field.name);
            } else if (await session.col(field.name).count() === 1) summary.schema.push(field.name);
            else if (mode === 'verify') summary.errors.push('Не найдено свойство «' + field.name + '».');
          }
          const failedColumns = new Set();
          for (const record of table.rows) {
            if (mode === 'apply') await session.step(record.title, () => session.addRow(record));
            else if (await session.row(record.title).count() !== 1) {
              if (mode !== 'preview') summary.errors.push('Не найдена строка «' + record.title + '».');
              continue;
            }
            summary.records.push(record.title);
            if (mode === 'preview') continue;
            for (const field of basic) {
              if (!(field.name in record.cells) || failedColumns.has(field.name)) continue;
              const value = record.cells[field.name];
              try {
                await session.step(record.title + ' / ' + field.name, async () => {
                  if (mode === 'apply') await session.value(record.title, field, value, field.replace === true);
                  else await session.expectValue(record.title, field, value);
                });
                summary.cells++;
              } catch (error) {
                summary.errors.push(error.message);
                failedColumns.add(field.name);
                await session.dismiss().catch(() => {});
              }
            }
          }
          const ids = basic.find(field => field.type === 'ID');
          if (mode === 'verify' && table.exactRowCount && await session.rows.count() !== table.rows.length) {
            summary.errors.push('Число сохранённых строк отличается от плана.');
          }
          if (ids && mode === 'verify' && summary.records.length === table.rows.length) {
            const values = await Promise.all(summary.records.map(async name =>
              (await (await session.cell(name, ids.name)).innerText()).trim()));
            if (values.some(value => !value) || new Set(values).size !== values.length) {
              summary.errors.push('Автоматические ID отсутствуют или повторяются.');
            } else {
              summary.ids = values;
            }
          }
          if (afterTable && !summary.errors.length) await afterTable(table, session);
        } catch (error) {
          summary.errors.push(error.message.split('\n')[0]);
        }
      }
    } finally {
      await page.close();
    }
  }));
  return tables.map(table => result.find(row => row.key === table.key));
}

export async function runSmartTableAdvanced(current, tables, mode, openTable, keys = tables.map(table => table.key), existingSession) {
  const result = { formulas: [], relations: [], rollups: [], views: [], errors: [], failed: [] };
  const pending = tables.filter(table => keys.includes(table.key) &&
    (table.views?.length || table.fields.some(field => ['Формула', 'Связи', 'Роллап'].includes(field.type))));
  await Promise.all(Array.from({ length: Math.min(existingSession ? 1 : 2, pending.length) }, async () => {
    const page = existingSession ? undefined : await current.context().newPage();
    try {
      if (page && tables.some(table => table.views?.some(view => view.widths))) {
        await page.setViewportSize({ width: 3000, height: 1000 });
      }
      while (pending.length) {
        const table = pending.shift();
        const fail = error => {
          result.errors.push(table.title + ' / ' + error.message.split('\n')[0]);
          if (!result.failed.includes(table.key)) result.failed.push(table.key);
        };
        let session;
        try { session = existingSession ?? await openTable(page, table); } catch (error) { fail(error); continue; }
        const run = async (label, work) => {
          try { return await session.step(label, work); }
          catch (error) {
            fail(error);
            await session.dismiss().catch(() => {});
          }
        };
        const verify = mode === 'verify';
        for (const field of table.fields) {
          if (field.type === 'Формула') {
            const values = await run(field.name, () => session.formula(field, table.rows, verify));
            if (values) result.formulas.push({ key: table.key, property: field.name, values });
          } else if (field.type === 'Связи') {
            const source = tables.find(candidate => candidate.key === field.target);
            const count = await run(field.name, async () => {
              if (!verify) await session.relation(field, source);
              for (const record of table.rows) {
                const expected = record.cells[field.name];
                if (!verify) await session.value(record.title, field, expected);
                else await session.step(record.title, () => session.expectValue(record.title, field, expected));
              }
              return table.rows.length;
            });
            if (count) result.relations.push({ key: table.key, property: field.name, source: source.url, count });
          } else if (field.type === 'Роллап') {
            const relation = table.fields.find(candidate => candidate.name === field.relation);
            const source = tables.find(candidate => candidate.key === relation.target);
            const values = await run(field.name, () => session.rollup(field, relation, table.rows, source, verify));
            if (values) result.rollups.push({ key: table.key, property: field.name, values });
          }
        }
        for (const item of table.views ?? []) {
          const configured = await run(table.title + ' / ' + item.name, () => session.appearance(item, verify));
          if (configured) result.views.push({ ...configured, key: table.key });
        }
      }
    } finally {
      if (page) await page.close();
    }
  }));
  return result;
}

export async function runSmartTables(current, tables, mode, data, advanced, openTable, previous) {
  const started = Date.now();
  const attempts = table => !previous || previous.failed.includes(table.key);
  const pending = tables.filter(attempts);
  if (mode === 'verify') {
    const batches = [];
    const confirmedRows = previous?.rows.filter(row => previous.failed.includes(row.key) && !row.errors.length) ?? [];
    const freshRows = await data(current, pending, mode, openTable, async (table, session) => {
      batches.push(await advanced(current, tables, mode, openTable, [table.key], session));
    }, confirmedRows);
    const rows = [...(previous?.rows.filter(row => !previous.failed.includes(row.key)) ?? []), ...freshRows];
    const extras = Object.fromEntries(['views', 'formulas', 'relations', 'rollups'].map(field => [field, [
      ...(previous?.extras?.[field]?.filter(item => !previous.failed.includes(item.key)) ?? []),
      ...batches.flatMap(batch => batch[field]),
    ]]));
    extras.errors = batches.flatMap(batch => batch.errors);
    extras.failed = batches.flatMap(batch => batch.failed);
    const dataFailed = rows.filter(row => row.errors.length).map(row => row.key);
    const failed = [...new Set([...dataFailed, ...extras.failed])];
    return { ok: !failed.length, rows, extras, failed, dataFailed, verifyMs: Date.now() - started };
  }
  const dataTarget = pending.filter(table => !previous?.advancedOnly?.includes(table.key));
  const freshRows = await data(current, dataTarget, mode === 'write' ? 'apply' : mode, openTable);
  const rows = [...(previous?.rows.filter(row => !dataTarget.some(table => table.key === row.key)) ?? []), ...freshRows];
  const dataMs = Date.now() - started;
  const failed = rows.filter(row => row.errors.length).map(row => row.key);
  if (mode === 'preview' || failed.length) {
    // При сбое базового этапа сохраняем его результаты, но сложные настройки ещё не выполнены.
    return { ok: !failed.length, rows, failed, dataMs, advancedPending: true };
  }
  const keys = previous?.advancedPending ? tables.map(table => table.key) : pending.map(table => table.key);
  const extras = await advanced(current, tables, mode === 'write' ? 'apply' : mode, openTable, keys);
  for (const field of ['views', 'formulas', 'relations', 'rollups']) {
    extras[field] = [...(previous?.extras?.[field].filter(item => !keys.includes(item.key)) ?? []), ...extras[field]];
  }
  const advancedMs = Date.now() - started - dataMs;
  if (mode !== 'apply' || extras.errors.length) {
    return { ok: !extras.errors.length, rows, extras, failed: extras.failed, advancedOnly: extras.failed, dataMs, advancedMs };
  }
  const checked = await runSmartTables(current, tables, 'verify', data, advanced, openTable);
  return { ...checked, dataMs, advancedMs, verifyMs: Date.now() - started - dataMs - advancedMs };
}
