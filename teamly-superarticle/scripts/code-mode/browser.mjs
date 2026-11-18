import { id, objectPath, requireValue, spacePath, targetUrl } from './plan.mjs';

const articlePath = new RegExp('^/at/' + id + '(?:/|$)', 'i');
const tablePath = new RegExp('^/(?:db|database|tbd|tb|table)/' + id + '(?:/|$)', 'i');
export const visible = locator => locator.filter({ visible: true });
export const button = (scope, name) => visible(scope.getByRole('button', { name, exact: true }));
export const testId = (scope, name) => visible(scope.locator('[data-test-id="' + name + '"]'));
export const text = (scope, value) => visible(scope.getByText(value, { exact: true }));
export const normalized = value => value.replace(/\s+/gu, ' ').trim();
const objectUrl = url => url.origin + url.pathname.replace(/\/$/u, '');
const spaceUrl = url => url.origin + url.pathname.split('/').slice(0, 3).join('/');

export async function poll(check, ms = 6000) {
  const deadline = Date.now() + ms;
  do {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 220));
  } while (Date.now() < deadline);
  return null;
}

export async function unique(locator, label, timeout = 6000) {
  const match = await poll(async () => {
    const count = await locator.count();
    requireValue(count <= 1, 'Найдено несколько элементов: ' + label);
    return count === 1;
  }, timeout);
  requireValue(match, 'Не найден элемент: ' + label);
  return locator;
}

export async function go(page, href, origin) {
  const desired = targetUrl(href, origin);
  await page.goto(desired.href, { waitUntil: 'domcontentloaded', timeout: 25000 });
  requireValue(new URL(page.url()).origin === origin && !new URL(page.url()).pathname.startsWith('/auth/'),
    'Проверьте вход в указанный Teamly и доступ к объекту.');
  const actual = new URL(page.url());
  if (objectPath.test(desired.pathname)) requireValue(objectUrl(actual) === objectUrl(desired), 'Teamly открыл другой объект.');
  if (spacePath.test(desired.pathname)) requireValue(spaceUrl(actual) === spaceUrl(desired), 'Teamly открыл другое пространство.');
}

export function locate(scope, target) {
  if (typeof target === 'string') return visible(scope.locator(target));
  const base = target.within ? visible(scope.locator(target.within)) : scope;
  if (target.css) return visible(base.locator(target.css));
  if (target.button) return button(base, target.button);
  if (target.text) return text(base, target.text);
  if (target.label) return visible(base.getByLabel(target.label, { exact: true }));
  return visible(base.getByPlaceholder(target.placeholder, { exact: true }));
}

export async function perform(page, steps, local) {
  const origin = new URL(page.url()).origin;
  for (const step of steps) {
    requireValue(new URL(page.url()).origin === origin && !new URL(page.url()).pathname.startsWith('/auth/'),
      'Последовательность вышла за пределы выбранного Teamly.');

    const target = locate(page, step.target);
    const control = step.do === 'upload' ? target : await unique(target, JSON.stringify(step.target));
    switch (step.do) {
      case 'click': await control.click(); break;
      case 'fill': await control.fill(step.value); break;
      case 'press': await control.press(step.value); break;
      case 'check': await control.setChecked(step.value !== false); break;
      case 'upload': {
        const scope = step.target.within ? page.locator(step.target.within) : page;
        const input = scope.locator(typeof step.target === 'string' ? step.target : step.target.css);
        requireValue(await input.count() === 1, 'Поле загрузки не определилось однозначно.');
        await input.setInputFiles(local(step.value));
        break;
      }
    }
  }
}

export async function matches(page, checks) {
  for (const check of checks) {
    const target = locate(page, check.target);
    const count = await target.count();
    if (check.state === 'count') {
      if (count !== check.value) return false;
      continue;
    }
    if (check.state === 'hidden') {
      if (count !== 0) return false;
      continue;
    }
    if (count !== 1) return false;
    if (check.state === 'text' && normalized(await target.innerText()) !== normalized(check.value)) return false;
    if (check.state === 'value' && await target.inputValue() !== check.value) return false;
    if (check.state === 'attribute' && await target.getAttribute(check.name) !== check.value) return false;
    if (check.state === 'checked' && await target.isChecked() !== (check.value !== false)) return false;
  }
  return true;
}

export async function tree(page, origin) {
  return page.locator('a.tree-item__link').evaluateAll((links, expectedOrigin) => links.flatMap(link => {
    if (new URL(link.href).origin !== expectedOrigin) return [];
    const node = link.closest('.drag-tree-node');
    const parent = node?.parentElement?.closest('.drag-tree-node');
    let parentLink = parent?.querySelector(':scope > .drag-tree-node__content a.tree-item__link') ??
      parent?.querySelector('a.tree-item__link');
    // The production sidebar flattens the tree and uses indentation for depth.
    if (!parentLink && node) {
      const indent = Number.parseFloat(node.style.paddingLeft) || 0;
      for (let sibling = node.previousElementSibling; indent > 0 && sibling; sibling = sibling.previousElementSibling) {
        if (!sibling.matches('.drag-tree-node')) continue;
        const siblingIndent = Number.parseFloat(sibling.style.paddingLeft) || 0;
        if (siblingIndent < indent) {
          parentLink = sibling.querySelector('a.tree-item__link');
          break;
        }
      }
    }
    const content = link.parentElement?.querySelector('.tree-item__content');
    const title = link.innerText.trim() || content?.innerText.trim() || link.title;
    return [{
      url: link.origin + link.pathname.replace(/\/$/u, ''),
      href: link.href,
      parent: parentLink ? parentLink.origin + parentLink.pathname.replace(/\/$/u, '') : null,
      title,
      draft: Boolean(content?.querySelector('use[href="#icon-draft"]')),
      root: Boolean(link.closest('.tree-item')?.querySelector('use[href="#icon-home"], use[href="#icon-home-filled"]'))
    }];
  }), origin);
}

function parentLink(page, href) {
  const url = new URL(href);
  return visible(page.locator('a.tree-item__link').and(page.locator([
    '[href=' + JSON.stringify(objectUrl(url)) + ']',
    '[href=' + JSON.stringify(url.pathname) + ']',
    '[href^=' + JSON.stringify(url.pathname + '?') + ']'
  ].join(','))));
}

export async function parentNode(page, parent, origin) {
  const href = parent.href ?? parent;
  if (objectUrl(new URL(page.url())) !== objectUrl(new URL(href))) await go(page, href, origin);
  const row = await unique(parentLink(page, parent.href ?? parent), 'узел родителя');
  return row.locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," tree-item ")][1]');
}

export async function discoverObject(page, item, target, origin, exactUrl) {
  if (target.kind === 'space') {
    if (spaceUrl(new URL(page.url())) !== target.href) await go(page, target.href, origin);
    await unique(testId(page, 'space-sidebar-create-button').or(button(page, 'Создать')).first(), 'дерево пространства');
    requireValue(!await text(page, 'Страница потерялась').count(), 'Страница пространства недоступна.');
  } else {
    const node = await parentNode(page, target, origin);
    const collapsed = visible(node.locator('button[aria-expanded="false"], button:has(use[href="#icon-arrow-right"])'));
    if (await collapsed.count() === 1) await collapsed.click();
  }
  const parent = target.kind === 'space' ? null : objectUrl(new URL(target.href));
  if (target.kind !== 'space') {
    const busy = visible(page.locator('.article-content-tree [aria-busy="true"], .article-content-tree .is-loading'));
    requireValue(await poll(async () => await busy.count() === 0, 3500), 'Ветка дерева ещё загружается.');
  }
  const candidates = (await tree(page, origin)).filter(row => row.parent === parent &&
    (item.kind === 'article' ? articlePath : tablePath).test(new URL(row.url).pathname));
  const url = exactUrl ? objectUrl(targetUrl(exactUrl, origin, objectPath)) : null;
  const matching = candidates.filter(row => url ? row.url === url : normalized(row.title) === normalized(item.title));
  requireValue(matching.length < 2, 'Совпало несколько объектов в одной ветке: ' + item.title);
  if (matching.length) return matching[0];
  if (url) return null;
  if (item.root) {
    const roots = candidates.filter(row => row.root);
    if (roots.length === 1) return roots[0];
    if (candidates.length === 1 && item.populateEmpty) return candidates[0];
    requireValue(candidates.length === 0, 'Корневая статья неоднозначна. Укажите её URL в плане.');
  }
  return null;
}

export async function createObject(page, item, target, origin, recordUrl) {
  let create;
  if (target.kind === 'space') {
    const byId = testId(page, 'space-sidebar-create-button');
    create = await unique(await byId.count() ? byId : button(page, 'Создать'), 'меню создания в пространстве');
  } else {
    const node = await parentNode(page, target, origin);
    await node.hover();
    create = await unique(node.locator('button').and(visible(page.locator(
      'button:has(use[href="#icon-plus"]), button[data-test-id*="create"], button[aria-label="Создать"]'))), 'меню создания в нужной ветке');
  }
  await create.click();
  const name = item.kind === 'article' ? 'Новая статья' : 'Умная таблица';
  const test = item.kind === 'article' ? 'create-article-button' : 'create-database-button';
  const byId = testId(page, test);
  const option = byId.or(button(page, name));
  await (await unique(option, name)).click();
  const expected = item.kind === 'article' ? articlePath : tablePath;
  const previous = new URL(target.href).pathname;
  await page.waitForURL(url => url.origin === origin && expected.test(url.pathname) && url.pathname !== previous,
    { timeout: 22000 });
  const href = new URL(page.url()).href;
  await recordUrl(href);
  return href;
}

export async function findSpace(page, space, origin, local, create) {
  if (space.url) {
    await go(page, space.url, origin);
    await unique(testId(page, 'space-sidebar-create-button').or(button(page, 'Создать')).first(), 'доступное пространство');
    return spaceUrl(new URL(page.url()));
  }
  await go(page, space.list, origin);
  const search = await unique(visible(page.getByRole('textbox', { name: 'Поиск по пространствам' })), 'поиск по всем пространствам');
  await search.fill(space.title);
  await search.press('Enter');
  const title = normalized(space.title);
  const started = Date.now();
  const findMatch = async () => {
    const links = await page.locator('a[href*="/sp/"]').evaluateAll((nodes, {title, origin}) => nodes
      .filter(node => node.origin === origin && node.getBoundingClientRect().height &&
        node.innerText.split('\n').some(value => value.replace(/\s+/gu, ' ').trim() === title))
      .map(node => node.href), {title, origin});
    const urls = [...new Set(links.filter(link => spacePath.test(new URL(link).pathname)).map(link => spaceUrl(new URL(link))))];
    requireValue(urls.length < 2, 'Совпало несколько пространств. Укажите точный URL.');
    if (urls.length === 1) return { href: urls[0] };
    if (Date.now() - started < 700) return null;
    return await text(page, /^(Ничего не найдено|Нет пространств|Пространства не найдены|Пространств пока нет|Здесь пока ещё ничего нет|Пока нет пространств|Нет доступных пространств)$/u).count()
      ? { empty: true } : null;
  };
  const result = await poll(findMatch, 4200);
  if (result?.href) return result.href;
  if (!create) return null;
  requireValue(result?.empty || (space.absence && await matches(page, space.absence)),
    'Интерфейс не подтвердил отсутствие одноимённого пространства. Сверьте список или укажите URL.');
  const top = button(page, 'Создать пространство').and(visible(page.locator('.space-list-page__action.create button')));
  await (await unique(top, 'мастер создания пространства')).click();
  const titleField = testId(page, 'create-space-popup-title');
  if (!await poll(() => titleField.count(), 1400)) {
    await (await unique(button(page, 'Создать пространство').and(visible(page.locator('[role="dialog"] button'))),
      'создание в открытом меню')).click();
  }
  await (await unique(titleField, 'название нового пространства')).fill(space.title);
  if (space.description) await (await unique(testId(page, 'create-space-popup-description'), 'описание')).fill(space.description);
  await (await unique(testId(page, 'create-space-popup-confirm-button'), 'следующий шаг мастера')).click();
  const fromScratch = text(page, 'С нуля');
  if (!await poll(async () => await fromScratch.count() || await testId(page, 'create-space-popup-title').count() === 0, 2000)) {
    throw new Error('Мастер остался на первом экране. Сверьте значения формы.');
  }
  if (space.settings) await perform(page, space.settings, local);
  if (!await poll(() => fromScratch.count(), 1500)) {
    await (await unique(button(page, /^(Далее|Продолжить)$/u), 'переход от настроек к шаблону')).click();
  }
  const template = await unique(fromScratch, 'шаблон «С нуля»');
  const card = template.locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," space-template-item ")][1]');
  const radio = card.locator('input[data-test-id="space-template-radio"]');
  if (await radio.count() === 1) {
    if (!await radio.isChecked()) await (await unique(visible(card.locator('.space-template-item__radio-overlay')), 'выбор «С нуля»')).click();
    requireValue(await radio.isChecked(), 'Шаблон «С нуля» не выбран.');
  } else {
    await template.click();
  }
  const confirm = testId(page, 'create-space-popup-confirm-button');
  const finish = space.finish ? locate(page, space.finish) : await confirm.count() === 1 ? confirm :
    button(page, /^(Создать|Создать пространство|Готово|Начать)$/u)
      .and(visible(page.locator('button:not(.space-list-page__action button):not(.message__actions button)')));
  await (await unique(finish, 'завершение мастера')).click();
  const opened = await poll(async () => {
    const url = new URL(page.url());
    if (url.origin !== origin) throw new Error('Мастер открыл другой хост.');
    return spacePath.test(url.pathname) ? spaceUrl(url) : null;
  }, 4000);
  if (opened) return opened;
  // Teamly can open the new root article or stay on the list after creation.
  return findSpace(page, space, origin, local, false);
}
