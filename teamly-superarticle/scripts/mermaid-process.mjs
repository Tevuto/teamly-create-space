import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const palettes = {
  marketing: ['#E5F2FF', '#4E80AD'],
  sales: ['#EEE5FF', '#8061A9'],
  technology: ['#E0F5F2', '#388478'],
  finance: ['#FFF0DD', '#A76A35'],
  people: ['#E3F5E5', '#528052'],
};
const otherPalettes = [
  ['#FBE8EB', '#A85065'], ['#E9ECFA', '#596EA2'], ['#FBF4D9', '#8E7430'],
  ['#EBF5DD', '#6F843A'], ['#F1E7F5', '#925D91'], ['#E2F1F8', '#487E9B'],
];
const shapes = {
  operation: { open: '[', close: ']', fill: '#FFFFFF', stroke: '#68768C' },
  document: { open: '[/', close: '/]', fill: '#DCEEFF', stroke: '#3F79AC' },
  decision: { open: '{', close: '}', fill: '#FFF1BE', stroke: '#946E20' },
  start: { open: '([', close: '])', fill: '#E9DDFB', stroke: '#7553A5' },
  end: { open: '([', close: '])', fill: '#DFF2E2', stroke: '#46784D' },
};

function requireValue(condition, message) {
  if (!condition) throw new Error(`Mermaid: ${message}`);
}

function requiredText(value, field) {
  requireValue(typeof value === 'string' && value.trim(), `укажите ${field}.`);
  return value.trim().replace(/\s+/gu, ' ');
}

function mermaidText(value) {
  return value.replace(/[&<>"#|]/gu, char => `#${char.codePointAt(0)};`);
}

function indexById(items, type) {
  requireValue(Array.isArray(items) && items.length > 0, `добавьте ${type}.`);
  const indexed = new Map();
  for (const item of items) {
    requireValue(typeof item?.id === 'string' && /^[a-z][a-z0-9_]*$/iu.test(item.id),
      `используйте идентификаторы из латинских букв, цифр и подчёркиваний (${type}).`);
    requireValue(!indexed.has(item.id), `идентификатор «${item.id}» повторяется.`);
    indexed.set(item.id, item);
  }
  return indexed;
}

function inferredPalette(name) {
  if (/маркетинг|marketing/iu.test(name)) return 'marketing';
  if (/продаж|sales/iu.test(name)) return 'sales';
  if (/пресейл|presale|\bIT\b|ИТ[-\s]|^ИТ$/iu.test(name)) return 'technology';
  if (/финанс|юрист|legal|finance/iu.test(name)) return 'finance';
  if (/\bHR\b|\bCS\b|внедрени|customer success/iu.test(name)) return 'people';
}

function clusterColors(participants) {
  const used = new Set();
  const colors = new Map();
  let fallback = 0;
  for (const { id, name, palette } of participants.values()) {
    requireValue(palette === undefined || Object.hasOwn(palettes, palette), `неизвестная палитра «${palette}» для «${name}».`);
    let color = palettes[palette ?? inferredPalette(name)];
    if (!color || used.has(color[0])) {
      const hue = (fallback * 137.508) % 360;
      color = otherPalettes[fallback] ?? [
        `hsl(${hue.toFixed(2)} 65% 92%)`,
        `hsl(${hue.toFixed(2)} 42% 42%)`,
      ];
      fallback++;
    }
    used.add(color[0]);
    colors.set(id, color);
  }
  return colors;
}

function reachable(adjacency, seeds) {
  const seen = new Set(seeds);
  const queue = [...seeds];
  for (const id of queue) {
    for (const next of adjacency.get(id)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

export function compileProcess(workflow) {
  const direction = workflow?.direction ?? 'TB';
  requireValue(direction === 'TB' || direction === 'LR', 'направление должно быть TB или LR.');
  const participants = indexById(workflow?.participants, 'участников');
  const nodes = indexById(workflow?.nodes, 'узлы процесса');
  const participantNames = new Set();
  const grouped = new Map();
  for (const [id, participant] of participants) {
    const name = requiredText(participant.name, `название участника «${id}»`);
    requireValue(!participantNames.has(name.toLocaleLowerCase('ru')), `участник «${name}» повторяется.`);
    participantNames.add(name.toLocaleLowerCase('ru'));
    participants.set(id, { ...participant, name });
    grouped.set(id, []);
  }
  const outgoing = new Map();
  const incoming = new Map();
  const conditions = new Map();
  for (const [id, node] of nodes) {
    requireValue(Object.hasOwn(shapes, node.kind), `неизвестный тип узла «${id}».`);
    requireValue(participants.has(node.participant), `укажите известного участника для «${id}».`);
    const text = mermaidText(requiredText(node.text, `подпись узла «${id}»`));
    const result = node.kind === 'operation'
      ? mermaidText(requiredText(node.result, `результат операции «${id}»`)) : '';
    const { open, close } = shapes[node.kind];
    grouped.get(node.participant).push(`N_${id}${open}"${text}${result ? `<br/>${result}` : ''}"${close}:::step_${node.kind}`);
    outgoing.set(id, []);
    incoming.set(id, []);
    if (node.kind === 'decision') conditions.set(id, new Set());
  }
  const idsOf = kind => [...nodes.values()].filter(node => node.kind === kind).map(node => node.id);
  const start = idsOf('start');
  const ends = idsOf('end');
  requireValue(start.length === 1 && ends.length, 'укажите один вход и хотя бы один выход процесса.');
  requireValue(idsOf('document').length && idsOf('operation').length, 'добавьте рабочую операцию и документ процесса.');
  requireValue(Array.isArray(workflow.links) && workflow.links.length, 'соедините узлы стрелками.');

  const handoffs = [];
  const seenLinks = new Set();
  for (const link of workflow.links) {
    const { from, to } = link ?? {};
    const source = nodes.get(from);
    const target = nodes.get(to);
    requireValue(source && target, `связь «${from} → ${to}» ссылается на неизвестный узел.`);
    requireValue(source.kind !== 'end' && target.kind !== 'start',
      `проверьте направление связи «${from} → ${to}» у входа или выхода.`);
    const condition = source.kind === 'decision' || link.label !== undefined
      ? requiredText(link.label, `подпись перехода «${from} → ${to}»`) : '';
    if (source.kind === 'decision') {
      const choices = conditions.get(from);
      const choice = condition.toLocaleLowerCase('ru');
      requireValue(!choices.has(choice), `условие «${condition}» у решения «${from}» повторяется.`);
      choices.add(choice);
    }
    const key = JSON.stringify([from, to, condition]);
    requireValue(!seenLinks.has(key), `связь «${from} → ${to}» повторяется.`);
    seenLinks.add(key);
    outgoing.get(from).push(to);
    incoming.get(to).push(from);
    const edge = `N_${from} -->${condition ? `|"${mermaidText(condition)}"|` : ''} N_${to}`;
    if (source.participant === target.participant) grouped.get(source.participant).push(edge);
    else handoffs.push(edge);
  }
  requireValue(handoffs.length > 0, 'покажите передачу работы между участниками.');
  for (const [id, choices] of conditions) {
    requireValue(choices.size >= 2, `у решения «${id}» должно быть хотя бы два подписанных перехода.`);
  }
  const fromStart = reachable(outgoing, start);
  const toEnd = reachable(incoming, ends);
  for (const id of nodes.keys()) {
    requireValue(fromStart.has(id), `узел «${id}» недоступен от начала процесса.`);
    requireValue(toEnd.has(id), `ветка «${id}» не ведёт к завершению.`);
  }
  const colors = clusterColors(participants);
  const lines = [`flowchart ${direction}`];
  for (const [id, { name }] of participants) {
    const statements = grouped.get(id);
    requireValue(statements.length, `у участника «${name}» нет этапов.`);
    lines.push(`  subgraph P_${id}["${mermaidText(name)}"]`, ...statements.map(statement => `    ${statement}`), '  end');
  }
  lines.push(...handoffs.map(edge => `  ${edge}`));
  for (const [id, [fill, stroke]] of colors) {
    lines.push(`  style P_${id} fill:${fill},stroke:${stroke},color:#1F2937,stroke-width:2px`);
  }
  for (const [kind, { fill, stroke }] of Object.entries(shapes)) {
    lines.push(`  classDef step_${kind} fill:${fill},stroke:${stroke},color:#1F2937`);
  }
  return { source: lines.join('\n'), clusters: participants.size, nodes: nodes.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv[2], 'запуск: node mermaid-process.mjs процесс.json');
    const { source } = compileProcess(JSON.parse(await readFile(process.argv[2], 'utf8')));
    process.stdout.write(`${source}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
