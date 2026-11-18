import { randomUUID } from 'node:crypto';
import { link, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const levels = [
  { title: 'Управление компанией', fill: '#DCCCF8', width: 320, height: 126, photo: 87 },
  { title: 'Руководство направлением', fill: '#EFE5FC', width: 300, height: 120, photo: 80 },
  { title: 'Руководитель блока', fill: '#FFFFFF', width: 282, height: 116, photo: 76 },
  { title: 'Сотрудники', fill: '#FAF9FE', width: 248, height: 108, photo: 68 },
];
const fields = [
  { key: 'name', size: 15, line: 19, bold: true, color: '#211A34', gap: 3 },
  { key: 'role', size: 13, line: 17, bold: true, color: '#382A50', gap: 4 },
  { key: 'responsibility', size: 12, line: 16, color: '#413951', gap: 5 },
  { key: 'phone', size: 12, line: 16, color: '#413951', gap: 0 },
  { key: 'email', size: 12, line: 16, color: '#413951', gap: 0 },
];
const photoTypes = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp', '.avif': 'avif' };
const backdrop = '#F7F8FC';
const connector = '#A996CF';
const margin = 32;
const leftGutter = 235;
const rowGap = 88;
const gap = 24;
const pad = 12;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\n', '&#10;');

function required(value, description) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Укажите ${description}.`);
  return value.trim();
}

function readHierarchy(spec, directory) {
  const title = required(spec.title, 'название диаграммы');
  const people = [];
  function visit(input, level) {
    const context = levels[level].title;
    const name = required(input?.name, `ФИО на уровне «${context}»`);
    const person = { id: `person-${people.length + 1}`, level, name };
    for (const { key } of fields.slice(1)) person[key] = required(input?.[key], `поле «${key}» для ${name}`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(person.email)) throw new Error(`Проверьте email для ${name}.`);
    const photo = required(input?.photo, `файл фотографии для ${name}`);
    const type = photoTypes[photo.match(/\.[^.]+$/u)?.[0]?.toLowerCase()];
    if (!type) throw new Error(`Фотография ${name} должна быть JPEG, PNG, WebP или AVIF.`);
    person.photo = { path: resolve(directory, photo), type };
    people.push(person);
    const children = input.children ?? [];
    if (!Array.isArray(children) || (level < 3 && children.length === 0) ||
        (level === 2 && children.length > 3) || (level === 3 && children.length !== 0)) {
      throw new Error(`Проверьте подчинённых в карточке «${name}»: у руководителя блока от 1 до 3 сотрудников, у сотрудника подчинённых нет.`);
    }
    person.children = children.map(child => visit(child, level + 1));
    return person;
  }
  const ceo = visit(spec.ceo, 0);
  return { title, ceo, people };
}

async function prepareCards(hierarchy) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 20_000 });
  try {
    const page = await browser.newPage();
    // Use the same font in the measurements and in the editable draw.io labels.
    const measured = await page.evaluate(({ people, levels, fields, pad }) => {
      const ctx = document.createElement('canvas').getContext('2d');
      function wrap(value, width) {
        const lines = [];
        let line = '';
        for (const word of value.split(/\s+/u)) {
          if (ctx.measureText([line, word].filter(Boolean).join(' ')).width <= width) {
            line = [line, word].filter(Boolean).join(' ');
            continue;
          }
          if (line) lines.push(line);
          line = '';
          for (const char of word) {
            if (line && ctx.measureText(line + char).width > width) {
              lines.push(line);
              line = '';
            }
            line += char;
          }
        }
        if (line) lines.push(line);
        return lines;
      }
      return people.map(person => fields.map(field => {
        ctx.font = `${field.bold ? 'bold ' : ''}${field.size}px Arial`;
        const level = levels[person.level];
        // Leave a small allowance for renderer font differences.
        return wrap(person[field.key], level.width - level.photo - pad * 2 - 4);
      }));
    }, { people: hierarchy.people.map(person => Object.fromEntries(
      ['level', ...fields.map(field => field.key)].map(key => [key, person[key]]))), levels, fields, pad });

    const heights = levels.map(level => level.height);
    hierarchy.people.forEach((person, index) => {
      person.lines = measured[index];
      person.textHeight = fields.reduce((sum, field, i) => sum + field.line * person.lines[i].length + field.gap, 0);
      heights[person.level] = Math.max(heights[person.level], person.textHeight + pad * 2);
    });
    for (let index = heights.length - 2; index >= 0; index--) {
      heights[index] = Math.max(heights[index], heights[index + 1] + 4);
    }

    const photos = new Map();
    for (const person of hierarchy.people) {
      const { path, type } = person.photo;
      const width = levels[person.level].photo;
      const height = heights[person.level];
      const key = JSON.stringify([path, width, height]);
      if (!photos.has(key)) {
        const source = (await readFile(path)).toString('base64');
        const thumbnail = await page.evaluate(async ({ source, type, width, height }) => {
          const image = new Image();
          image.src = `data:image/${type};base64,${source}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width * 1.4);
          canvas.height = Math.round(height * 1.4);
          const ctx = canvas.getContext('2d');
          ctx.beginPath();
          ctx.roundRect(0, 0, canvas.width, canvas.height, 10);
          ctx.clip();
          const zoom = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
          const w = image.naturalWidth * zoom;
          const h = image.naturalHeight * zoom;
          ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
          return canvas.toDataURL('image/webp', 0.84).replace(';base64,', ',');
        }, { source, type, width, height }).catch(error => {
          throw new Error(`Фотография «${path}» не открылась в Chrome.`, { cause: error });
        });
        photos.set(key, thumbnail);
      }
      person.thumbnail = photos.get(key);
    }
    return heights;
  } finally {
    await browser.close();
  }
}

function layout({ ceo, people }, heights) {
  const rows = [96];
  for (let index = 1; index < levels.length; index++) rows.push(rows[index - 1] + heights[index - 1] + rowGap);
  function measure(person) {
    person.slot = Math.max(0, ...person.children.map(measure));
    person.span = Math.max(levels[person.level].width,
      person.children.length * person.slot + Math.max(0, person.children.length - 1) * gap);
    return person.span;
  }
  function place(person, center) {
    const width = levels[person.level].width;
    person.rect = { x: center - width / 2, y: rows[person.level], w: width, h: heights[person.level] };
    person.children.forEach((child, index) =>
      place(child, center + (index - (person.children.length - 1) / 2) * (person.slot + gap)));
  }
  measure(ceo);
  place(ceo, leftGutter + ceo.span / 2);
  const segments = [];
  const midpoint = ({ x, w }) => x + w / 2;
  const add = (x1, y1, x2, y2) => {
    if (x1 !== x2 || y1 !== y2) segments.push({ x1, y1, x2, y2 });
  };
  for (const { rect, children } of people) {
    if (!children.length) continue;
    const x = midpoint(rect);
    const bottom = rect.y + rect.h;
    const top = children[0].rect.y;
    if (children.length === 1) {
      add(x, bottom, midpoint(children[0].rect), top);
      continue;
    }
    const bus = (bottom + top) / 2;
    const centers = children.map(child => midpoint(child.rect));
    add(x, bottom, x, bus);
    add(centers[0], bus, centers.at(-1), bus);
    for (const center of centers) add(center, bus, center, top);
  }
  const labels = levels.map((level, index) => ({
    title: level.title, x: margin, y: rows[index] - 34, w: leftGutter - margin - 14, h: 24,
  }));
  const width = leftGutter + ceo.span + margin;
  const height = rows.at(-1) + heights.at(-1) + margin;
  return { width, height, labels, segments };
}

function validateGeometry(people, labels, segments) {
  const rectangles = [...people.map(person => person.rect), ...labels];
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x &&
    a.y < b.y + b.h && a.y + a.h > b.y;
  if (rectangles.some((rect, index) => rectangles.slice(index + 1).some(other => overlap(rect, other)))) {
    throw new Error('Карточки или подписи уровней пересекаются.');
  }
  for (const { x1, y1, x2, y2 } of segments) {
    if (x1 !== x2 && y1 !== y2) throw new Error('Найден диагональный соединительный отрезок.');
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    if (rectangles.some(rect => x1 === x2
      ? x > rect.x && x < rect.x + rect.w && y < rect.y + rect.h && Math.max(y1, y2) > rect.y
      : y > rect.y && y < rect.y + rect.h && x < rect.x + rect.w && Math.max(x1, x2) > rect.x)) {
      throw new Error('Соединение проходит через карточку или подпись уровня.');
    }
  }
}

function vertex(id, value, style, { x, y, w, h }, parent = '1') {
  return `<mxCell id="${id}" value="${escape(value)}" style="${escape(style)}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
}

function text(id, value, rect, font, parent) {
  const { size, bold, color } = font;
  const style = `text;html=0;spacing=0;align=left;verticalAlign=middle;overflow=visible;fontFamily=Arial;fontSize=${size};fontColor=${color};fontStyle=${bold ? 1 : 0};`;
  return vertex(id, value, style, rect, parent);
}

function render({ title, people }, { width, height, labels, segments }) {
  const rectStyle = (fill, stroke) => `rounded=1;arcSize=10;absoluteArcSize=1;fillColor=${fill};strokeColor=${stroke};`;
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>',
    vertex('background', '', `shape=rectangle;fillColor=${backdrop};strokeColor=none;movable=0;resizable=0;deletable=0;connectable=0;`,
      { x: 0, y: 0, w: width, h: height }),
    text('heading', title, { x: margin, y: 24, w: width - margin * 2, h: 27 }, { size: 22, bold: true, color: '#211A34' }),
  ];
  for (const [index, { x1, y1, x2, y2 }] of segments.entries()) {
    cells.push(`<mxCell id="line-${index}" edge="1" parent="1" style="edgeStyle=none;noEdgeStyle=1;rounded=0;startArrow=none;endArrow=none;strokeColor=${connector};strokeWidth=2;"><mxGeometry relative="1" as="geometry"><mxPoint x="${x1}" y="${y1}" as="sourcePoint"/><mxPoint x="${x2}" y="${y2}" as="targetPoint"/></mxGeometry></mxCell>`);
  }
  for (const [index, label] of labels.entries()) {
    cells.push(text(`level-${index}`, label.title, label, { size: 13, bold: true, color: '#544278' }));
  }
  for (const { id, rect, level, thumbnail, textHeight, lines } of people) {
    const { photo, fill } = levels[level];
    cells.push(vertex(id, '', 'group;', rect));
    cells.push(vertex(`${id}-card`, '', rectStyle(fill, '#D5CCE5'), { x: 0, y: 0, w: rect.w, h: rect.h }, id));
    cells.push(vertex(`${id}-photo`, '', `shape=image;imageAspect=0;image=${thumbnail};strokeColor=none;`,
      { x: 0, y: 0, w: photo, h: rect.h }, id));
    let y = (rect.h - textHeight) / 2;
    for (const [index, field] of fields.entries()) {
      for (const [lineIndex, line] of lines[index].entries()) {
        cells.push(text(`${id}-${field.key}-${lineIndex}`, line,
          { x: photo + pad, y, w: rect.w - photo - pad * 2, h: field.line }, field, id));
        y += field.line;
      }
      y += field.gap;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
<diagram id="organization" name="${escape(title)}"><mxGraphModel grid="0" page="1" pageScale="1" pageWidth="${width}" pageHeight="${height}" background="${backdrop}"><root>
${cells.join('\n')}
</root></mxGraphModel></diagram>
</mxfile>\n`;
}

export async function generateOrgChart(specPath, outputPath) {
  if (!outputPath?.endsWith('.drawio')) throw new Error('Укажите выходной файл с расширением .drawio.');
  const spec = JSON.parse(await readFile(specPath, 'utf8'));
  const hierarchy = readHierarchy(spec, dirname(specPath));
  const heights = await prepareCards(hierarchy);
  const geometry = layout(hierarchy, heights);
  validateGeometry(hierarchy.people, geometry.labels, geometry.segments);
  const xml = render(hierarchy, geometry);
  // Publish the complete file without replacing a previously authored diagram.
  const temporary = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, xml, { flag: 'wx', mode: 0o600 });
    await link(temporary, outputPath).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      if (await readFile(outputPath, 'utf8') !== xml) {
        throw new Error(`Файл «${outputPath}» уже существует с другим содержимым. Укажите другой путь .drawio.`);
      }
    });
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return { xml, cards: hierarchy.people.length, segments: geometry.segments.length, width: geometry.width, height: geometry.height };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , spec, output] = process.argv;
    if (!spec || !output) throw new Error('Запуск: node drawio-org.mjs структура.json организация.drawio');
    const { cards, segments, width, height } = await generateOrgChart(resolve(spec), resolve(output));
    console.log(JSON.stringify({ file: resolve(output), cards, segments, width, height }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
