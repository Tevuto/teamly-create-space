import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const id = () => `data-id="${randomUUID()}"`;
const p = text => `<p ${id()}>${escape(text)}</p>`;
const h = (level, text) => `<h${level} class="heading" main="true" ${id()}>${escape(text)}</h${level}>`;
const rule = () => `<hr ${id()}>`;
const bold = text => `<p ${id()}><strong>${escape(text)}</strong></p>`;
const node = (kind, contents = '', attrs = '') =>
  `<div data-node-type="${kind}" ${attrs}>${contents}</div>`;

export const criteriaMarkup = plan => h(3, plan.criteria.title) + plan.criteria.items.map(p).join('');

function panel({ title, text }) {
  return node('panel', bold(title) + p(text), `data-type="note" type="note" main="true" ${id()}`);
}

export const comparisonHeadingColors = {
  ready: '#38761D',
  warning: '#783F04',
  note: '#1C4587',
};
export const comparisonHeadingFont = { family: 'Oswald', weight: 700 };

function comparisonPanel({ tone, title, text }) {
  const color = comparisonHeadingColors[tone];
  const { family, weight } = comparisonHeadingFont;
  const heading = `<p ${id()}><span style="font-family: ${family}; font-weight: ${weight}"><strong><span style="font-size: 1.25rem; color: ${color}">${escape(title)}</span></strong></span></p>`;
  return node('panel', heading + p(text), `data-type="${tone}" type="${tone}" main="true" ${id()}`);
}

function columns(contents) {
  const width = 100 / contents.length;
  return node('columns', contents.map(content =>
    node('column', `<div class="column-body">${content}</div>`,
      `${id()} data-basis="${width}" style="flex-basis:${width}%"`)
  ).join(''), id());
}

function layoutSection(columns) {
  return `<div data-layout-section="true" ${id()}>${columns.map(([width, content]) =>
    `<div data-layout-column="true" data-column-width="${width}" style="flex-basis:${width}%"><div data-layout-content="true">${content}</div></div>`
  ).join('')}</div>`;
}

function hero(image) {
  return layoutSection([[66.66, image], [33.33, bold('Оглавление') + node('table-of-contents', '', id())]]);
}

function list(items, checklist = false) {
  if (checklist) {
    return `<ul class="todo-list" main="true" data-type="todo_list" ${id()}>${items.map(text =>
      `<li data-type="todo_item" data-checked="false" data-done="false" ${id()}><label><input type="checkbox"><span></span></label><div>${p(text)}</div></li>`
    ).join('')}</ul>`;
  }
  return `<ul class="bullet-list" main="true" ${id()}>${items.map(text =>
    `<li class="list-item" ${id()}>${p(text)}</li>`
  ).join('')}</ul>`;
}

function table(rows) {
  return `<table ${id()} data-mode="base" data-visibility="visible" data-labels="[]" data-pinned-cols="0" main="true"><tbody>${rows.map((row, index) => {
    const tag = index === 0 ? 'th' : 'td';
    return `<tr ${id()}>${row.map(cell => `<${tag} ${id()}>${p(cell)}</${tag}>`).join('')}</tr>`;
  }).join('')}</tbody></table>`;
}

function disclosure({ title, text, comparison }, image = '') {
  const comparisonLayout = comparison
    ? layoutSection(comparison.map(item => [100 / comparison.length, comparisonPanel(item)]))
    : '';
  return node('expand', node('expand-title', escape(title)) +
    node('expand-content', p(text) + comparisonLayout + image), 'class="expand-block"');
}

function mermaid(source) {
  return node('code-block',
    node('code-editor', escape(source), `language="javascript" oncreate="false" ${id()}`),
    `language="mermaid" viewmode="content" main="true" ${id()}`);
}

export function drawioUrl(xml) {
  const compressed = deflateRawSync(encodeURIComponent(xml)).toString('base64');
  return `https://viewer.diagrams.net/?lightbox=1&nav=1&layers=1#R${encodeURIComponent(compressed)}`;
}

function frame({ title, url, height = 500 }) {
  const source = `data-src="${escape(url)}"`;
  return node('remote-iframe', node('remote-iframe-title', escape(title), source) +
    node('remote-iframe-content', '', `${source} data-height="${height}"`),
  'class="remote-iframe-block"');
}

function link({ title, url }) {
  const safe = escape(url);
  return `<p ${id()}><a href="${safe}" data-url="${safe}" data-type="external" data-editor-link="true">${escape(title)}</a></p>`;
}

export function articleMarkup(plan, key, media, { synced }) {
  const page = plan.pages[key];
  const asset = item => {
    const html = media[item];
    if (!html) throw new Error(`Не найден загруженный блок: ${item}`);
    return html;
  };
  switch (key) {
    case 'main': {
      const preparation = h(2, 'Подготовка') + panel(page.preparation) +
        columns([bold('📋 Что подготовить') + list(page.materials),
          bold('☑️ Чек-лист') + list(page.checklist, true)]) + asset(page.form);
      const checkpoints = rule() + h(2, 'Контрольные точки') + table(page.checkpoints);
      const review = h(2, 'Разбор примера') + synced +
        page.disclosures.map(item => disclosure(item, item.image ? asset(item.image) : '')).join('') +
        asset(page.video);
      return p(page.intro) + hero(asset(page.hero)) + preparation + checkpoints + review;
    }
    case 'process': {
      const section = page.process;
      const diagram = mermaid(section.mermaid);
      const notes = panel(section.note);
      const flow = section.outcome
        ? diagram + notes + h(3, 'Ожидаемый результат') + p(section.outcome)
        : notes + diagram;
      return p(page.intro) + h(2, section.title) + p(section.text) + flow + rule() +
        h(2, page.owners.title) + p(page.owners.text) + panel(page.owners.note);
    }
    case 'documents':
      return panel(page.intro) + h(2, page.materialsTitle) + p(page.materialsIntro) +
        columns(page.files.map(asset)) + rule() +
        columns(page.figures.map(item => asset(item.file) + p(item.caption))) +
        h(2, 'Пример правильного заполнения') + synced +
        (page.example.kind === 'teamly' ? table(page.example.rows) : '');
    case 'map':
      return p(page.intro) + panel(page.note) + h(2, page.widget.title) + frame(page.widget) +
        link(page.original);
    default:
      throw new Error(`Неизвестная страница: ${key}`);
  }
}

export function trailingWidget(plan, key, orgChart) {
  if (key === 'process') {
    return {
      type: 'remote_diagram',
      attrs: { id: randomUUID(), src: orgChart, width: 900, height: 540, layout: 'center', main: true },
    };
  }
  if (key === 'documents' && plan.pages.documents.example.kind === 'google-docs') {
    const { url, height = 600 } = plan.pages.documents.example;
    return { type: 'remote_docs', attrs: { id: randomUUID(), src: url, height, main: true } };
  }
  return null;
}

export function articleFiles(plan, key) {
  const page = plan.pages[key];
  if (key === 'main') {
    return [page.hero, page.form, ...page.disclosures.flatMap(item => item.image ? [item.image] : []), page.video];
  }
  if (key === 'documents') return [...page.files, ...page.figures.map(item => item.file)];
  return [];
}
