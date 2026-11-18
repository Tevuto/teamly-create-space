import { basename } from 'node:path';
import { articleEditor, setEditorContent, upload, uploadedMedia } from '../teamly-browser.mjs';
import { button, go, normalized, poll, testId, unique, visible } from './browser.mjs';
import { requireValue } from './plan.mjs';

function titleField(page) {
  return visible(page.locator([
    '[data-test-id="article-title"]:is(input, textarea, [contenteditable])',
    '[data-test-id="article-title"] :is(input, textarea, [contenteditable])',
    '.editor__title [contenteditable]'
  ].join(', ')));
}

async function articleContent(page, item) {
  const editor = articleEditor(page);
  if (await editor.count() !== 1 || !await editor.isVisible()) return null;
  const body = normalized(await editor.innerText());
  if (!item.expect.every(phrase => body.includes(normalized(phrase)))) return null;
  const media = await uploadedMedia(editor);
  if (!(item.files ?? []).every(file => Object.hasOwn(media, basename(file).normalize()))) return null;
  return true;
}

export async function verifyArticle(page, item, href, origin, { reload = true } = {}) {
  if (reload || page.url() !== href) await go(page, href, origin);
  const ready = await poll(async () => {
    const candidates = titleField(page);
    const title = await candidates.count() === 1
      ? await candidates.evaluate(element => element.value ?? element.innerText)
      : (await testId(page, 'article-title').allInnerTexts()).join('') || await page.title();
    return normalized(title) === normalized(item.title) && await articleContent(page, item);
  }, reload ? 3500 : 1200);
  if (!ready) return null;
  const draft = await button(page, 'Опубликовать').count() > 0 ||
    await page.locator('.tree-item:has(a[href=' + JSON.stringify(new URL(href).pathname) + ']) use[href="#icon-draft"]').count() > 0;
  if (item.publish && draft) return null;
  return { publication: draft ? 'черновик' : 'сохранено' };
}

export async function writeArticle(page, item, object, origin, local) {
  const { href, created } = object;
  if (page.url() !== href) await go(page, href, origin);
  const editor = await unique(visible(articleEditor(page, true)), 'редактор статьи');
  const field = await unique(titleField(page), 'заголовок статьи');
  const current = normalized(await field.evaluate(element => element.value ?? element.innerText));
  const body = await editor.evaluate(el => {
    const copy = el.cloneNode(true);
    const media = copy.querySelectorAll('[data-node-type="mediaWrapper"], [data-node-type="media"]');
    for (const block of media) block.remove();
    return { text: copy.textContent.trim(), hasBlocks: Boolean(copy.querySelector('[data-node-type]')) };
  });
  const existingMedia = Object.keys(await uploadedMedia(editor));
  const plannedMedia = new Set((item.files ?? []).map(file => basename(file).normalize()));
  const resumableMedia = created && existingMedia.every(file => plannedMedia.has(file));
  const known = await articleContent(page, item);
  requireValue(known || (!body.text && !body.hasBlocks && (resumableMedia || (!existingMedia.length && item.populateEmpty))),
    'В существующей статье есть содержание либо заполнение пустой статьи не задано. Продолжите адресными UI-шагами.');
  requireValue(created || item.populateEmpty || current === item.title,
    'Для изменения заголовка существующей статьи укажите populateEmpty для пустой статьи либо адресные UI-шаги.');
  if (current !== item.title) {
    await field.click();
    await field.press('ControlOrMeta+a');
    await page.keyboard.insertText(item.title);
    await field.press('Tab');
    requireValue(await poll(async () => normalized(await field.evaluate(element => element.value ?? element.innerText)) === item.title, 2600),
      'Заголовок не сохранился в редакторе.');
  }
  if (!known) {
    await editor.focus();
    for (const file of item.files ?? []) {
      const available = await uploadedMedia(editor);
      if (!Object.hasOwn(available, basename(file).normalize())) await upload(page, editor, local(file));
    }
    const media = await uploadedMedia(editor);
    const html = item.html + (item.files ?? []).map(file => {
      const markup = media[basename(file).normalize()];
      requireValue(markup, 'Загрузка не подтверждена: ' + basename(file));
      return markup;
    }).join('');
    await setEditorContent(editor, html);
    requireValue(await articleContent(page, item), 'После вставки не все фрагменты статьи отображаются.');
  }
  if (item.publish) {
    const publish = button(page, 'Опубликовать');
    const url = new URL(href);
    const treeDraft = page.locator('.tree-item:has(a[href=' + JSON.stringify(url.pathname) + ']) use[href="#icon-draft"]');
    if (await publish.count() || await treeDraft.count()) {
      const publishPath = '/api/v1/wiki/articles/' + url.pathname.split('/').filter(Boolean).at(-1) + '/publish';
      const publishButton = await unique(publish, 'публикация статьи');
      const [response] = await Promise.all([
        page.waitForResponse(reply => new URL(reply.url()).origin === origin &&
          new URL(reply.url()).pathname === publishPath && reply.request().method() === 'POST',
        { timeout: 12000 }).catch(error => {
          if (error.name !== 'TimeoutError') throw error;
          return null;
        }),
        publishButton.click(),
      ]);
      requireValue(!response || response.ok(), 'Teamly отклонил публикацию статьи.');
      requireValue(await poll(async () => await publish.count() === 0 && await treeDraft.count() === 0, 15000),
        'Публикация статьи не подтверждена.');
    }
  } else {
    const save = button(page, /^(Сохранить черновик|В черновики)$/u);
    if (await save.count() === 1) await save.click();
  }
}
