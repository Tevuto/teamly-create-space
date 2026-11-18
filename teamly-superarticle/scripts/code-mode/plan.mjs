import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

export const id = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
export const spacePath = new RegExp('^/sp/' + id + '(?:/|$)', 'i');
export const objectPath = new RegExp('^/(?:at|db|database|tbd|tb|table)/' + id + '(?:/|$)', 'i');
const keyPattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const fieldTypes = new Set(['Текст', 'Число', 'Выбор', 'Статус', 'Дата', 'Исполнитель', 'ID']);
const actions = new Set(['click', 'fill', 'press', 'check', 'upload']);
const states = new Set(['visible', 'hidden', 'text', 'value', 'checked', 'attribute', 'count']);

export function requireValue(value, message) {
  if (!value) throw new Error(message);
}

function string(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function targetUrl(value, origin, pattern) {
  const url = new URL(value);
  requireValue(url.protocol === 'https:' && !url.username && !url.password &&
    (!origin || url.origin === origin) && (!pattern || pattern.test(url.pathname)),
    'Нужен URL объекта на указанном HTTPS-хосте Teamly.');
  return url;
}

function selector(value) {
  return string(value) || (value && typeof value === 'object' && (!value.within || string(value.within)) &&
    [value.css, value.text, value.button, value.label, value.placeholder].filter(string).length === 1);
}

function assertChecks(checks, label) {
  requireValue(Array.isArray(checks) && checks.length && checks.every(check => selector(check.target) &&
    states.has(check.state) && (!['text', 'value', 'attribute'].includes(check.state) || typeof check.value === 'string') &&
    (check.state !== 'attribute' || string(check.name)) &&
    (check.state !== 'count' || (Number.isInteger(check.value) && check.value >= 0))),
  label + ': нужны конкретные проверки результата.');
}

function assertSteps(steps, label) {
  requireValue(Array.isArray(steps) && steps.length && steps.every(step => selector(step.target) &&
    actions.has(step.do) && (step.do !== 'check' || step.value === undefined || typeof step.value === 'boolean') && (!['fill', 'press', 'upload'].includes(step.do) || typeof step.value === 'string') &&
    (step.do !== 'upload' || typeof step.target === 'string' || string(step.target.css))),
  label + ': недопустимые действия в редакторе.');
}

function uniqueNames(objects, name, label) {
  requireValue(objects.every(object => string(object?.[name])) &&
    new Set(objects.map(object => object[name].trim())).size === objects.length, label + ': нужны разные имена.');
}

export async function readPlan(filename) {
  const source = await readFile(filename, 'utf8');
  const plan = JSON.parse(source);
  const { space, items } = plan;
  requireValue(plan.version === 1 && space && Array.isArray(items), 'Нужны version: 1, space и массив items.');
  const { origin } = targetUrl(space.url ?? space.list);
  requireValue(Boolean(space.url) !== Boolean(space.list), 'Укажите один адрес пространства или списка.');
  if (space.url) targetUrl(space.url, origin, spacePath);
  else {
    targetUrl(space.list, origin, /^\/space(?:\/list(?:\/[\w-]+)?)?\/?$/);
    requireValue(string(space.title) && typeof space.create === 'boolean', 'Укажите имя пространства и create.');
    if (space.settings) assertSteps(space.settings, 'Настройки мастера');
    if (space.finish) requireValue(selector(space.finish), 'Укажите кнопку завершения мастера.');
  }
  const files = new Set();
  if (space.absence) assertChecks(space.absence, 'Проверка списка пространств');
  for (const step of space.settings ?? []) if (step.do === 'upload') files.add(step.value);
  const parents = new Set(['space']);
  const branches = new Set();
  const keys = new Set(['space']);
  let roots = 0;
  for (const item of items) {
    requireValue(item && keyPattern.test(item.key ?? '') && !keys.has(item.key) && !Object.hasOwn(Object.prototype, item.key), 'Ключи объектов должны быть уникальными.');
    if (item.requires) requireValue(Array.isArray(item.requires) &&
      item.requires.every(key => keys.has(key) && key !== 'space'), item.key + ': requires должен ссылаться на предыдущие шаги.');
    keys.add(item.key);
    if (item.kind === 'manual' || item.kind === 'ui') {
      requireValue(parents.has(item.on) && string(item.title), item.key + ': нужен предыдущий целевой объект и название.');
      if (item.kind === 'ui') {
        assertSteps(item.steps, item.key);
        assertChecks(item.verify, item.key);
        if (item.before) {
          assertSteps(item.before, item.key);
          requireValue(item.before.every(step => step.do === 'click'), item.key + ': before открывает только панели просмотра.');
        }
        for (const step of [...(item.before ?? []), ...item.steps]) {
          if (step.do === 'upload') files.add(step.value);
        }
      }
    } else {
      requireValue(['article', 'table'].includes(item.kind) && string(item.title) && parents.has(item.parent ?? 'space'),
        item.key + ': нужен тип, заголовок и существующий ключ родителя.');
      const branch = (item.parent ?? 'space') + '\0' + item.title.trim();
      requireValue(!branches.has(branch), item.key + ': заголовок уже используется у этого родителя.');
      branches.add(branch);
      if (item.url) {
        const url = targetUrl(item.url, origin, objectPath);
        requireValue(url.pathname.startsWith('/at/') === (item.kind === 'article'), item.key + ': тип URL отличается от типа объекта.');
      }
      if (item.root) {
        roots += 1;
        requireValue(roots === 1 && item.kind === 'article' && (item.parent ?? 'space') === 'space', 'Допустима одна корневая статья пространства.');
      }
      if (item.kind === 'article') {
        requireValue(string(item.html) && Array.isArray(item.expect) && item.expect.length && item.expect.every(string),
          item.key + ': нужны HTML и фразы для проверки сохранения.');
        requireValue(!/<\s*(?:script|iframe|object|embed|style)\b|\bon\w+\s*=|javascript\s*:/iu.test(item.html),
          item.key + ': используйте содержимое редактора. Встраивания задавайте отдельными шагами UI.');
        if (item.files) {
          requireValue(Array.isArray(item.files) && item.files.every(string), item.key + ': files должен быть списком путей.');
          uniqueNames(item.files.map(path => ({name: basename(path).normalize()})), 'name', item.key + ' files');
          item.files.forEach(path => files.add(path));
        }
      } else {
        const fields = item.fields ?? [];
        const rows = item.rows ?? [];
        requireValue(Array.isArray(fields) && Array.isArray(rows), item.key + ': fields и rows должны быть массивами.');
        uniqueNames(fields, 'name', item.key + ' fields');
        uniqueNames(rows, 'title', item.key + ' rows');
        const types = new Map(fields.map(field => [field.name, field.type]));
        for (const field of fields) {
          requireValue(fieldTypes.has(field.type), item.key + ': свойство «' + field.name + '» задайте отдельными UI-шагами.');
          if (field.options) {
            requireValue(field.type === 'Выбор' && Array.isArray(field.options), 'Варианты допустимы у свойства «Выбор».');
            uniqueNames(field.options.map(name => ({name})), 'name', field.name);
          }
        }
        for (const row of rows) {
          for (const [field, value] of Object.entries(row.cells ?? {})) {
            const type = types.get(field);
            const input = value && typeof value === 'object' ? value.input : value;
            requireValue((input === value || string(value.display)) && type && type !== 'ID' &&
              (type === 'Число' ? Number.isFinite(input) : string(input)),
              item.key + ': некорректное значение «' + field + '» в строке «' + row.title + '».');
          }
        }
      }
      parents.add(item.key);
    }
  }
  const local = path => resolve(dirname(filename), path);
  const fingerprint = createHash('sha256').update(source);
  for (const file of [...files].sort()) {
    requireValue((await stat(local(file))).isFile(), 'Ожидался файл: ' + file);
    fingerprint.update(await readFile(local(file)));
  }
  return { plan, origin, local, fingerprint: fingerprint.digest('hex') };
}
