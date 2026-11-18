import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const questionTypes = [
  'Один правильный ответ', 'Несколько правильных ответов', 'Открытый ответ', 'Сопоставление', 'Последовательность',
];

export async function readCourse(filename, plan, { requireCoverScenes = false } = {}) {
  const course = JSON.parse(await readFile(filename, 'utf8'));
  const validText = value => typeof value === 'string' && value.trim().length > 0;
  if (![course.title, course.folder, course.description, course.cover].every(validText) ||
      course.title.length > 255 || course.description.length > 500 ||
      !Array.isArray(course.materials) || course.materials.length < 4 || course.materials.length > 6) {
    throw new Error('Укажите название, описание, обложку, папку и 4–6 материалов курса.');
  }
  const cover = resolve(dirname(filename), course.cover);
  const image = await readFile(cover);
  if (image.length > 10_000_000 || image.length < 24 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      image.readUInt32BE(16) !== 2500 || image.readUInt32BE(20) !== 500) {
    throw new Error('Укажите подготовленную обложку курса в PNG 2500 × 500, до 10 МБ.');
  }
  const coverDigest = createHash('sha256').update(image).digest('hex');
  const keys = new Set();
  const moduleTitles = new Set();
  const titles = new Set();
  const covered = new Set();
  const materials = course.materials.map((material, index) => {
    const article = plan.pages.find(page => page.key === material.key && page.kind !== 'database');
    if (!article || keys.has(material.key) || material.tests?.length !== 2 || material.tests[0].type === material.tests[1].type) {
      throw new Error('У каждого материала нужна существующая статья и два теста разных типов: ' + material.key);
    }
    const module = material.module ?? (index + 1) + '. ' + article.title;
    if (!validText(module) || module.length > 255 || moduleTitles.has(module)) {
      throw new Error('Укажите уникальное название модуля для «' + article.title + '».');
    }
    moduleTitles.add(module);
    keys.add(material.key);
    for (const test of material.tests) {
      const { title, type, prompt, answers, pairs, items } = test;
      const validAnswers = () => Array.isArray(answers) && answers.length >= 2 &&
        answers.every(answer => validText(answer.text)) && answers.some(answer => !answer.correct);
      const correct = answers?.filter(answer => answer.correct).length ?? 0;
      const validOptions = {
        'Один правильный ответ': () => validAnswers() && correct === 1,
        'Несколько правильных ответов': () => validAnswers() && correct >= 2,
        'Открытый ответ': () => validText(test.expected),
        'Сопоставление': () => pairs?.length >= 2 && pairs.every(pair => pair.length === 2 && pair.every(validText)),
        'Последовательность': () => items?.length >= 2 && items.every(validText),
      };
      if (!validText(title) || titles.has(title) || !validText(prompt) ||
          !questionTypes.includes(type) || !validOptions[type]()) {
        throw new Error('Проверьте тип, вопрос и варианты ответов теста «' + title + '».');
      }
      titles.add(title);
      covered.add(type);
    }
    return { ...material, title: article.title, module };
  });
  if (!questionTypes.every(type => covered.has(type))) throw new Error('В курсе нужны все пять типов вопросов.');
  if ((requireCoverScenes || course.coverScenes) && (
    !Array.isArray(course.coverScenes) || course.coverScenes.length !== materials.length ||
    course.coverScenes.some((scene, index) => scene?.key !== materials[index].key || !validText(scene.description))
  )) throw new Error('Опишите сцены новой обложки в порядке материалов курса (coverScenes).');
  return { ...course, cover, coverDigest, host: plan.host, spaceTitle: plan.title, materials };
}

export function bindCourse(course, objects) {
  const space = new URL(objects.space.url);
  if (space.origin !== course.host || !/^\/sp\/[a-f\d-]{36}$/iu.test(space.pathname)) {
    throw new Error('Укажите собранное пространство Teamly.');
  }
  return { ...course, spaceUrl: space.origin + space.pathname, materials: course.materials.map(material => {
    const source = objects[material.key];
    if (source?.checks?.published === false) throw new Error('Исходная статья не опубликована: «' + material.title + '».');
    const article = new URL(source?.url);
    if (article.origin !== course.host || !/^\/at\/[a-f\d-]{36}$/iu.test(article.pathname)) {
      throw new Error('Не найден адрес существующей статьи «' + material.title + '».');
    }
    return { ...material, url: article.origin + article.pathname };
  }) };
}

export async function courseTest(page, test, mode) {
  const wait = { timeout: 9500 };
  const button = name => page.getByRole('button', { name, exact: true }).filter({ visible: true });
  const fail = detail => { throw new Error(test.title + ' — ' + detail); };
  const verify = mode === 'verify';
  let changed = false;
  async function field(target, expected) {
    await target.waitFor(wait);
    const value = await target.evaluate(el => el.value ?? el.innerText);
    if (value === expected) return;
    if (verify) fail('не подтверждено поле «' + expected + '».');
    await target.fill(expected, wait);
    changed = true;
  }
  async function appendRows(rows, add, values, fill) {
    for (const [index, item] of values.entries()) {
      if (await rows.count() <= index) {
        if (verify) fail('вопрос содержит меньше вариантов, чем в плане.');
        await add.click(wait);
      }
      await fill(rows.nth(index), item);
    }
    if (await rows.count() !== values.length) fail('вопрос содержит лишние варианты.');
  }
  await button('Добавить вопрос').waitFor(wait);
  await page.getByRole('img', { name: 'Загрузка, пожалуйста подождите', exact: true }).last()
    .waitFor({ ...wait, state: 'hidden' });
  await field(page.locator('.course-editable-text__input.title [contenteditable]'), test.title);
  const prompt = page.getByPlaceholder('Введите вопрос', { exact: true });
  if (!await prompt.count()) {
    if (verify) fail('отсутствует вопрос.');
    await button('Добавить вопрос').click(wait);
    await button(test.type).click(wait);
  }
  await field(prompt, test.prompt);
  const type = page.getByRole('combobox', { name: 'Search for option', exact: true });
  await type.getByText(test.type, { exact: true }).waitFor(wait);
  if (test.answers) {
    const rows = page.locator('.select-question__answers-item');
    await appendRows(rows, page.locator('.select-question__add-button'), test.answers,
      (row, answer) => field(row.locator('textarea'), answer.text));
    const checked = () => rows.evaluateAll(es => es.map(row =>
      row.querySelector('input')?.checked || Boolean(row.querySelector('.checkbox__indicator.checked'))));
    const desired = test.answers.map(answer => Boolean(answer.correct));
    if (JSON.stringify(await checked()) !== JSON.stringify(desired)) {
      if (verify) fail('отметки правильных ответов отличаются от плана.');
      await page.locator('.select-question__check').click(wait);
      for (const [index, correct] of desired.entries()) {
        const option = rows.nth(index).locator('label.select-question__answers-item-input');
        const input = option.locator('input');
        if (await input.isChecked() !== correct) {
          await input.press('Space', wait);
          if (await input.isChecked() !== correct) fail('не удалось отметить вариант ' + (index + 1) + '.');
        }
      }
      await page.locator('.select-question__check:visible').click(wait);
      changed = true;
    }
    if (JSON.stringify(await checked()) !== JSON.stringify(desired)) fail('правильные ответы не подтвердились.');
  } else if (test.items) {
    const entries = page.locator('.sequence-question__answer-text [contenteditable]');
    await appendRows(entries, page.locator('.sequence-question__add-button'), test.items, field);
  } else if (test.pairs) {
    const entries = page.locator('.match-question__element-text [contenteditable]');
    const add = page.locator('.match-question__add-button');
    for (const index of test.pairs.keys()) {
      if (await entries.count() < (index + 1) * 2) {
        if (verify) fail('не хватает пар для сопоставления.');
        await add.click(wait);
        await entries.nth((index + 1) * 2 - 1).waitFor(wait);
      }
    }
    if (await entries.count() !== test.pairs.length * 2) fail('в вопросе есть лишние пары.');
    for (const [index, pair] of test.pairs.entries()) {
      await field(entries.nth(index), pair[0]);
      await field(entries.nth(index + test.pairs.length), pair[1]);
    }
  } else {
    await page.getByPlaceholder('Ваш ответ', { exact: true }).waitFor(wait);
  }
  if (!verify && changed) {
    const save = button('Сохранить');
    if (await save.isEnabled(wait)) await save.click(wait);
    await page.locator('aside').getByText(test.title, { exact: true }).waitFor(wait);
  }
  return { title: test.title, type: test.type, url: page.url() };
}

export async function courseMaterial(page, course, material, mode) {
  const wait = { timeout: 10500 };
  const name = page.locator('main [contenteditable="plaintext-only"]').first();
  await name.waitFor(wait);
  const verify = mode === 'verify';
  if ((await name.innerText(wait)).trim() !== material.title) {
    if (verify) throw new Error('Не подтверждено название материала «' + material.title + '».');
    await name.fill(material.title, wait);
    await name.press('Tab', wait);
  }
  const path = new URL(material.url).pathname;
  const source = page.locator('main article a').filter({ visible: true }).and(
    page.locator('a[href="' + material.url + '"],a[href="' + path + '"]'));
  if (!await source.count()) {
    if (verify) {
      await source.waitFor(wait);
      return { title: material.title, source: material.url, url: page.url() };
    }
    if (await page.locator('main article a[href*="/at/"]').count()) {
      throw new Error('Материал уже связан с другой статьёй: ' + material.title);
    }
    await page.getByRole('button', { name: 'Добавить блок', exact: true }).last().click(wait);
    await page.getByRole('button', { name: 'Добавить статью', exact: true }).click(wait);
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Введите название пространства или выберите из списка').fill(course.spaceTitle, wait);
    await dialog.getByRole('option', { name: course.spaceTitle, exact: true }).click(wait);
    await dialog.getByPlaceholder('Введите название статьи или выберите из списка').fill(material.title, wait);
    await dialog.getByRole('option', { name: material.title, exact: true }).click(wait);
    await dialog.getByRole('button', { name: 'Добавить', exact: true }).click(wait);
    await source.waitFor(wait);
  }
  return { title: material.title, source: material.url, url: page.url() };
}

export async function runCourse(current, course, mode, previous, writeTest, writeMaterial, checkpoint = async () => {}) {
  const started = Date.now();
  const wait = { timeout: 11000 };
  const page = await current.context().newPage();
  const result = { ok: false, timingsMs: {}, materials: [], tests: [], errors: [] };
  const timed = async (label, op) => {
    const began = Date.now();
    try { return await op(); }
    finally { result.timingsMs[label] = Date.now() - began; }
  };
  const stepList = course.materials.flatMap(material => [
    { ...material, kind: 'material' },
    ...material.tests.map(test => ({ ...test, kind: 'test', module: material.module })),
  ]);
  const open = async (tab, url) => {
    if (tab.url() !== url) await tab.goto(url, { ...wait, waitUntil: 'commit' });
  };
  const button = (tab, name) => tab.getByRole('button', { name, exact: true }).filter({ visible: true });
  async function overview() {
    if (previous?.url) {
      const known = new URL(previous.url);
      if (known.origin !== course.host || !/^\/course\/[a-f\d-]{36}\/control$/iu.test(known.pathname)) {
        throw new Error('Некорректный адрес курса для продолжения.');
      }
      await open(page, known.href);
    } else {
      await open(page, course.host + '/courses/control');
      await page.getByRole('link', { name: course.folder, exact: true }).click(wait);
      const search = page.getByRole('textbox', { name: 'Поиск по курсам', exact: true });
      const [response] = await Promise.all([
        page.waitForResponse(reply => {
          const url = new URL(reply.url());
          return url.pathname === '/api/v2/learning/control-courses' && url.searchParams.get('query') === course.title;
        }, wait),
        search.fill(course.title, wait),
      ]);
      if (!response.ok()) throw new Error('Не удалось получить результаты поиска курса.');
      const { items, pagination } = await response.json();
      if (!Array.isArray(items) || items.some(item => typeof (item.title ?? item.name) !== 'string')) {
        throw new Error('Teamly вернул неизвестный формат поиска курса.');
      }
      const matches = items.filter(item => (item.title ?? item.name) === course.title);
      const entry = page.getByRole('link', { name: course.title, exact: true });
      if (pagination?.lastPage > pagination?.currentPage) throw new Error('Поиск курса вернул неполную выдачу.');
      if (matches.length > 1) throw new Error('В папке есть несколько курсов «' + course.title + '».');
      if (matches.length === 1) {
        if (mode === 'write' && !previous?.pendingCreation) throw new Error('Курс «' + course.title + '» уже существует в папке.');
        await entry.click(wait);
      } else {
        if (mode === 'verify' || previous?.pendingCreation) throw new Error('Курс «' + course.title + '» не найден после создания.');
        if (!items.length) await page.getByText('Ничего не найдено', { exact: true }).waitFor(wait);
        const create = button(page, 'Создать курс');
        if (await create.count()) await create.click(wait);
        else {
          await button(page, 'Создать').last().click(wait);
          await create.click(wait);
        }
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('textbox', { name: 'Название курса', exact: true }).fill(course.title, wait);
        result.pendingCreation = true;
        await checkpoint(result);
        await dialog.getByRole('button', { name: 'Создать', exact: true }).click(wait);
        await dialog.waitFor({ ...wait, state: 'hidden' });
      }
    }
    const title = page.locator('.course-editable-text__input.title [contenteditable]');
    await title.waitFor(wait);
    if ((await title.innerText(wait)).trim() !== course.title) throw new Error('Открыт другой курс.');
    return (await page.getByRole('link', { name: 'Обзор курса', exact: true }).getAttribute('href', wait));
  }
  async function cover(action = mode, saved = previous) {
    const image = page.locator('.course-cover img');
    if (action === 'verify' || saved?.coverPath) await image.waitFor(wait);
    const assetPath = () => image.evaluate(img => new URL(img.src).pathname, undefined, wait);
    const oldPath = await image.count() ? await assetPath() : null;
    const current = saved?.coverDigest === course.coverDigest && saved?.coverPath === oldPath;
    if (!current) {
      if (action === 'verify') throw new Error('В курсе не подтверждена обложка из профиля.');
      const banner = page.locator('.course-cover');
      await banner.hover(wait);
      const edit = button(page, 'Редактировать обложку');
      if (await edit.count()) await edit.click(wait);
      else await page.locator('button.course-control__title-button').click(wait);
      const dialog = page.getByRole('dialog');
      if (oldPath) await dialog.locator('button.cover-form__file-content-buttons-item:has(use[href="#icon-bin"])').click(wait);
      const file = dialog.locator('input[type=file]');
      await file.setInputFiles(course.cover, wait);
      await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click(wait);
      await image.waitFor(wait);
      await page.waitForFunction(previousPath => {
        const uploaded = document.querySelector('.course-cover img');
        return uploaded && new URL(uploaded.src).pathname !== previousPath;
      }, oldPath, wait);
    }
    await image.waitFor(wait);
    const dimensions = await image.evaluate(async img => {
      if (!img.complete) await img.decode();
      const box = img.getBoundingClientRect();
      return { file: [img.naturalWidth, img.naturalHeight], frame: [box.width, box.height] };
    });
    if (!dimensions.file[0] || !dimensions.file[1]) {
      throw new Error('Картинка обложки не загружается.');
    }
    if (Math.abs(dimensions.frame[0] / dimensions.frame[1] - 5) > 0.02 ||
        Math.abs(dimensions.file[0] / dimensions.file[1] - 5) > 0.02) {
      throw new Error('В Teamly обложка курса имеет пропорции, отличные от 5:1.');
    }
    result.coverDigest = course.coverDigest;
    result.coverPath = await assetPath();
    result.coverDimensions = dimensions.file;
    const summary = page.locator('.course-description__editor [contenteditable]');
    await summary.waitFor(wait);
    if ((await summary.innerText(wait)).trim() !== course.description) {
      if (action === 'verify') throw new Error('Описание курса отличается от плана.');
      await summary.fill(course.description, wait);
      await summary.press('Tab', wait);
    }
    result.cover = true;
  }
  async function structure(action = mode) {
    const side = page.locator('aside');
    await side.getByText('Структура курса', { exact: true }).waitFor(wait);
    const rows = side.locator('.course-tree-items__item[data-item-kind="node"]');
    const row = id => rows.and(side.locator('[id="' + id + '"]'));
    const zone = id => side.locator('[data-item-kind="module-add-zone"][data-module-id="' + id + '"]');
    const title = '.course-tree-item__title';
    const nodes = () => rows.evaluateAll((elements, selector) => elements.map(el => ({
      id: el.dataset.sourceId,
      parent: el.dataset.parentId || null,
      title: el.querySelector(selector)?.textContent.trim(),
      url: el.querySelector(':scope > .course-tree-item > a')?.href,
      kind: el.dataset.itemType === 'lesson' ? 'material' : el.dataset.itemType,
      open: Boolean(el.querySelector('.education-module.open')),
    })), title);
    const testTitle = node => !node.title || node.title === 'Без названия';
    const current = await nodes();
    if (current.some(node => node.kind !== 'module' && !node.parent)) {
      throw new Error('В курсе есть элементы вне модулей. Для продолжения сначала разместите их в модулях.');
    }

    async function addModule(name) {
      await side.locator('button.education-lesson-add__trigger-button').click(wait);
      await button(page, 'Модуль').click(wait);
      const box = side.locator('.education-module:has(.title-field__content)');
      await box.locator('.title-field__content [contenteditable]').fill(name, wait);
      await box.locator('button:has(use[href="#icon-checkmark"])').click(wait);
      await side.getByText(name, { exact: true }).waitFor(wait);
    }
    const used = new Set();
    const results = [];
    const moduleIds = [];
    for (const material of course.materials) {
      const findModule = async () => {
        const matches = (await nodes()).filter(node => node.kind === 'module' && node.title === material.module);
        if (matches.length > 1) throw new Error('Найдено несколько модулей «' + material.module + '».');
        return matches[0];
      };
      let module = await findModule();
      if (!module) {
        if (action === 'verify') throw new Error('Отсутствует модуль «' + material.module + '».');
        const editing = side.locator('.education-module:has(.title-field__content)');
        if (!await editing.count()) await addModule(material.module);
        else {
          await editing.locator('.title-field__content [contenteditable]').fill(material.module, wait);
          await editing.locator('button:has(use[href="#icon-checkmark"])').click(wait);
          await side.getByText(material.module, { exact: true }).waitFor(wait);
        }
        module = await findModule();
      }
      moduleIds.push(module.id);
      if (!module.open) await row(module.id).locator('.education-module__arrow-button').click(wait);
      for (const item of stepList.filter(step => step.module === material.module)) {
        const eligible = (await nodes()).filter(node => node.kind === item.kind && !used.has(node.id));
        const named = eligible.filter(candidate => candidate.title === item.title);
        const blank = eligible.filter(candidate => candidate.parent === module.id && testTitle(candidate));
        if (named.length > 1 || (!named.length && blank.length > 1)) {
          throw new Error('Найдено несколько элементов курса для «' + item.title + '».');
        }
        let node = named[0] ?? blank[0];
        if ((node && node.parent !== module.id) || (action === 'verify' && node?.title !== item.title)) {
          throw new Error('Не подтверждено вложение «' + item.title + '» в «' + material.module + '».');
        }
        if (!node) {
          const before = new Set(eligible.map(candidate => candidate.id));
          const inModule = rows.and(side.locator('[data-parent-id="' + module.id + '"]'));
          const count = await inModule.count();
          await zone(module.id).locator('button.course-tree-items__module-add-trigger').click(wait);
          await button(page, item.kind === 'material' ? 'Материал' : 'Тест').click(wait);
          await inModule.nth(count).waitFor(wait);
          node = (await nodes()).find(candidate => candidate.parent === module.id &&
            candidate.kind === item.kind && !used.has(candidate.id) && !before.has(candidate.id));
          if (!node) throw new Error('Не подтверждено создание «' + item.title + '».');
        }
        used.add(node.id);
        results.push({ ...item, entry: node.url, id: node.id, moduleId: module.id });
      }
    }
    const actual = await nodes();
    const order = course.materials.flatMap((material, index) => [
      moduleIds[index], ...results.filter(item => item.module === material.module).map(item => item.id),
    ]);
    if (actual.length !== order.length || actual.some((node, index) => node.id !== order[index])) {
      throw new Error('Порядок модулей и их материалов отличается от плана.');
    }
    result.modules = course.materials.map((material, index) => ({ title: material.module, id: moduleIds[index] }));
    return results;
  }
  async function publication(tab, action) {
    const published = button(tab, 'Снять с публикации');
    const publish = button(tab, 'Опубликовать');
    await published.or(publish).first().waitFor(wait);
    if (!await published.count()) {
      if (action === 'verify') throw new Error('Элемент курса не опубликован.');
      await publish.click(wait);
      const confirmation = tab.getByRole('dialog').getByRole('button', { name: /^(Опубликовать|Подтвердить)$/u });
      await published.or(confirmation).first().waitFor(wait);
      if (await confirmation.count()) await confirmation.click(wait);
      await published.waitFor(wait);
    }
    return true;
  }
  async function batch(steps, handler) {
    const queue = steps.slice();
    const records = new Map();
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        const tab = await current.context().newPage();
        try {
          await open(tab, item.entry);
          records.set(item.entry, await handler(tab, item));
        } catch (error) {
          result.errors.push({ title: item.title, url: item.entry, error: error.message.split('\n').slice(0, 4).join('\n') });
        } finally {
          await tab.close();
        }
      }
    }));
    return steps.map(item => records.get(item.entry)).filter(Boolean);
  }
  try {
    await page.setViewportSize({ width: 1600, height: 1400 });
    if (mode === 'preview') {
      await open(page, course.host + '/courses/control');
      await page.getByRole('link', { name: course.folder, exact: true }).waitFor(wait);
      await open(page, course.spaceUrl);
      await page.locator('aside').getByText(course.spaceTitle, { exact: true }).first().waitFor(wait);
      result.ok = true;
      result.planned = stepList.map(({ title, kind, type, url, module }) => ({ module, title, kind, type, url }));
      return result;
    }
    result.url = new URL(await timed('course', overview), course.host).href;
    delete result.pendingCreation;
    await checkpoint(result);
    await timed('cover', cover);
    const entries = await timed('structure', structure);
    const materials = entries.filter(item => item.kind === 'material');
    const tests = entries.filter(item => item.kind === 'test');
    if (previous?.verified) result.verified = previous.verified;
    const material = async (tab, item, action) => ({
      ...await writeMaterial(tab, course, item, action), published: await publication(tab, action),
    });
    const test = async (tab, item, action) => ({
      ...await writeTest(tab, item, action), published: await publication(tab, action),
    });
    if (mode === 'apply' || mode === 'write') {
      const write = (targets, prior = [], handler) => {
        const saved = prior.filter(item => item.published && targets.some(target => target.title === item.title));
        return batch(targets.filter(item => !saved.some(known => known.title === item.title)),
          (tab, item) => handler(tab, item, 'apply')).then(added => [...saved, ...added]);
      };
      result.materials = await timed('materials', () => write(materials, previous?.materials, material));
      result.tests = await timed('tests', () => write(tests, previous?.tests, test));
    }
    if (!result.errors.length && mode !== 'write') {
      await timed('verification', async () => {
        if (mode === 'apply') {
          await open(page, result.url);
          await cover('verify', result);
          await structure('verify');
        }
        const known = mode === 'verify' ? previous?.verified ?? [] : [];
        const pending = entries.filter(item => !known.some(saved => saved.title === item.title && saved.published &&
          ('source' in saved) === (item.kind === 'material')));
        const checked = [...known, ...await batch(pending, (tab, item) =>
          (item.kind === 'material' ? material : test)(tab, item, 'verify'))];
        result.materials = checked.filter(item => 'source' in item);
        result.tests = checked.filter(item => 'type' in item);
      });
    }
    result.order = entries.map(({ kind, title, entry, module }) => ({ module, kind, title, url: entry }));
    result.ok = !result.errors.length && result.materials.length === materials.length && result.tests.length === tests.length;
    return result;
  } catch (error) {
    result.errors.push({ error: error.message.split('\n')[0] });
    return result;
  } finally {
    result.timingsMs.total = Date.now() - started;
    await page.close();
  }
}
