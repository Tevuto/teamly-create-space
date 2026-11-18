import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { discoverObject, createObject, findSpace, go, matches, perform, poll } from './code-mode/browser.mjs';
import { verifyArticle, writeArticle } from './code-mode/article.mjs';
import { verifyTable, writeTable } from './code-mode/table.mjs';
import { ensureStep, retryAllows, withJournal } from './code-mode/journal.mjs';
import { readPlan, requireValue } from './code-mode/plan.mjs';

function reason(error) {
  return error.message.split('\n')[0];
}

function compactPending(pending) {
  const counts = new Map();
  for (const entry of pending) {
    const reason = typeof entry === 'string' ? 'Не подтверждено после повторного открытия' : entry.reason;
    const group = counts.get(reason) ?? { reason, count: 0, examples: [] };
    group.count += 1;
    if (group.examples.length < 3) group.examples.push(typeof entry === 'string' ? entry : entry.step);
    counts.set(reason, group);
  }
  return [...counts.values()];
}

async function resolveSpace(page, settings, state, save, write, retry) {
  const { plan, origin, local } = settings;
  const specification = state.objects.space ? { url: state.objects.space.href } : plan.space;
  let created = false;
  const beforeCreate = write && plan.space.create && !state.objects.space ? async () => {
    const step = 'space:create';
    requireValue(!state.steps[step] || retryAllows(retry, step),
      'Проверьте исход шага «' + step + '». Если результат точно отсутствует, повторите с --retry ' + step + '.');
    state.steps[step] = 'pending';
    await save();
    created = true;
  } : undefined;
  const href = await findSpace(page, specification, origin, local, beforeCreate);
  requireValue(href, 'Пространство не найдено. Сверьте ссылку, имя и права доступа.');
  const space = state.objects.space ?? { href, kind: 'space', ...(created && { created }) };
  if (write && (!state.objects.space || state.steps['space:create'] === 'pending')) {
    state.objects.space = space;
    if (state.steps['space:create'] === 'pending') state.steps['space:create'] = 'verified';
    await save();
  }
  return space;
}

async function resolveObject(page, item, parent, settings, state, save, write, retry) {
  const { origin } = settings;
  let known = state.objects[item.key];
  const explicit = known?.href ?? item.url;
  const find = () => discoverObject(page, item, parent, origin, explicit);
  let discovered = await find();
  if (!discovered && write && !explicit) {
    const creation = async () => {
      const href = await createObject(page, item, parent, origin, async href => {
        state.objects[item.key] = { href, kind: item.kind, created: true };
        await save();
      });
      known = state.objects[item.key];
      discovered = await discoverObject(page, item, parent, origin, href);
      requireValue(discovered, 'Новый объект создан, но вложенность пока не подтверждена: ' + href);
    };
    discovered = await ensureStep(state, save, item.key + ':create', async () => discovered ?? await find(), creation, retry);
  }
  requireValue(discovered, 'Объект не подтверждён в нужной ветке. Сверьте дерево и URL.');
  const object = known ?? { href: item.url ?? discovered.href, kind: item.kind, created: false };
  if (write && (!state.objects[item.key] || state.steps[item.key + ':create'] === 'pending')) {
    state.objects[item.key] = object;
    if (state.steps[item.key + ':create'] === 'pending') state.steps[item.key + ':create'] = 'verified';
    await save();
  }
  return object;
}

async function runUI(page, item, target, settings, state, save, write, retry) {
  const { origin, local } = settings;
  const read = async () => {
    await go(page, target.href, origin);
    if (item.before) await perform(page, item.before, local);
    return poll(() => matches(page, item.verify));
  };
  if (write) {
    await ensureStep(state, save, item.key, read, async () => {
      // Start the recorded actions on the same page state on every attempt.
      await go(page, target.href, origin);
      await perform(page, item.steps, local);
    }, retry);
    return true;
  }
  return Boolean(await read());
}

export async function runPlan(page, settings, state, save, options) {
  const { plan, origin, local } = settings;
  const { write, retry } = options;
  const objects = new Map();
  const results = [];
  const verifiedKeys = new Set();
  const space = await resolveSpace(page, settings, state, save, write, retry);
  objects.set('space', space);
  for (const item of plan.items) {
    const key = item.key;
    const result = { key, status: 'требует проверки' };
    results.push(result);
    try {
      const dependency = item.requires?.find(key => !verifiedKeys.has(key));
      requireValue(!dependency, 'Сначала подтвердите шаг «' + dependency + '».');
      const parent = objects.get(item.on ?? item.parent ?? 'space');
      requireValue(parent, 'Сначала завершите родительский объект «' + (item.on ?? item.parent) + '».');
      if (item.kind === 'manual') {
        result.url = parent.href;
        result.reason = item.title;
        continue;
      }
      if (item.kind === 'ui') {
        result.url = parent.href;
        if (await runUI(page, item, parent, settings, state, save, write, retry)) {
          result.status = 'проверено';
          verifiedKeys.add(key);
        }
        else result.reason = 'Контрольный признак не найден.';
        continue;
      }
      const object = await resolveObject(page, item, parent, settings, state, save, write, retry);
      result.url = object.href;
      objects.set(key, object);
      if (item.kind === 'article') {
        let reload = !write || Boolean(state.steps[key + ':content']);
        const read = () => {
          const verified = verifyArticle(page, item, object.href, origin, { reload });
          reload = true;
          return verified;
        };
        const status = write
          ? await ensureStep(state, save, key + ':content', read, () => writeArticle(page, item, object, origin, local), retry)
          : await read();
        if (status) Object.assign(result, status, { status: 'проверено' });
        else result.reason = 'Текст, вложения или статус публикации не подтверждены.';
      } else {
        const pending = write ? await writeTable(page, item, object, { origin, state, save, retry }) : [];
        const checked = await verifyTable(page, item, object.href, origin);
        if (checked.correctTitle && !checked.missing.length) result.status = 'проверено';
        else {
          result.reason = checked.correctTitle ? 'Часть схемы или строк не подтверждена после повторного открытия.' : 'Заголовок таблицы не подтверждён.';
          result.pending = compactPending(pending.length ? pending : checked.missing);
        }
      }
      if (result.status === 'проверено') verifiedKeys.add(key);
    } catch (error) {
      result.reason = reason(error);
      if (!result.url && state.objects[key]) result.url = state.objects[key].href;
    }
  }
  const verified = results.filter(result => result.status === 'проверено').length;
  return { ok: verified === results.length, space: space.href, verified, total: results.length, items: results };
}

async function main() {
  const { values, positionals: [command, file, extra] } = parseArgs({
    allowPositionals: true,
    options: { profile: { type: 'string' }, state: { type: 'string' }, retry: { type: 'string', multiple: true }, headless: { type: 'boolean' } }
  });
  requireValue(['check', 'sign-in', 'build', 'verify'].includes(command) && file && !extra,
    'Запуск: node teamly-code.mjs <check|sign-in|build|verify> <план.json> [--profile каталог] [--state файл] [--retry ключ] [--headless]');
  requireValue(!values.retry || command === 'build', '--retry используется только с build.');
  requireValue(!values.headless || command !== 'sign-in', 'Для входа нужен видимый браузер.');
  const filename = resolve(file);
  const settings = await readPlan(filename);
  if (command === 'check') {
    const counts = {};
    for (const item of settings.plan.items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    return { ok: true, objects: counts, fingerprint: settings.fingerprint };
  }
  requireValue(values.profile, 'Укажите отдельный профиль Chrome через --profile.');
  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext(resolve(values.profile), {
    channel: 'chrome', headless: Boolean(values.headless), viewport: { width: 1520, height: 980 }, timeout: 18000
  });
  try {
    context.setDefaultTimeout(6500);
    const page = context.pages()[0] ?? await context.newPage();
    if (command === 'sign-in') {
      const { origin, plan } = settings;
      await page.goto(plan.space.url ?? plan.space.list, { waitUntil: 'domcontentloaded' });
      if (new URL(page.url()).pathname.startsWith('/auth/')) {
        await page.waitForURL(url => url.origin === origin && !url.pathname.startsWith('/auth/'), { timeout: 300000 });
      }
      requireValue(new URL(page.url()).origin === origin, 'Вход на указанный Teamly не подтверждён.');
      return { ok: true, host: origin };
    }
    const statePath = resolve(values.state ?? filename + '.state.json');
    return await withJournal(statePath, settings.fingerprint, command === 'build', (state, save) =>
      runPlan(page, settings, state, save, { write: command === 'build', retry: values.retry }));
  } finally {
    await context.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await main();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, reason: reason(error) }) + '\n');
    process.exitCode = 1;
  }
}
