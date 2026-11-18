const text = value => typeof value === 'string' && Boolean(value.trim());
const normalized = value => value.normalize('NFC').toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ').trim();

function containsPhrase(fragment, phrase) {
  const escaped = normalized(phrase).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp('(^|[^\\p{L}\\p{M}\\p{N}])' + escaped + '($|[^\\p{L}\\p{M}\\p{N}])', 'u').test(normalized(fragment));
}

function driveFile(value, allowDocument = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    return (url.hostname === 'drive.google.com' && (
      /^\/file\/d\/[\w-]+(?:\/|$)/u.test(url.pathname) ||
      (url.pathname === '/open' && /^[\w-]+$/u.test(url.searchParams.get('id') ?? ''))
    )) || (allowDocument && url.hostname === 'docs.google.com' && /^\/document\/d\/[\w-]+(?:\/|$)/u.test(url.pathname));
  } catch {
    return false;
  }
}

export function prepareDemo(plan, work, covers) {
  const { images, aiSearch } = plan.demo ?? {};
  const keys = new Set([...covers.map(page => page.key), 'ILLUSTRATION-1', 'ILLUSTRATION-2', 'COURSE']);
  if (!driveFile(images?.index, true)) {
    throw new Error('В demo.images.index укажите ссылку на реестр картинок в папке Google Drive.');
  }
  const imageLinks = Object.entries(images.links ?? {});
  if (imageLinks.some(([key, url]) => !keys.has(key) || !driveFile(url))) {
    throw new Error('В demo.images.links указывайте ключи обложек и иллюстраций со ссылками на файлы Google Drive.');
  }
  const section = aiSearch?.section;
  const sources = plan.pages.filter(page => section && page.parent === section && page.kind !== 'database');
  const pages = new Map((work?.articles ?? []).map(article => [article.key, article]));
  if (!/^SEC-0[1-4]$/u.test(section ?? '') || !sources.length || sources.some(page => !pages.has(page.key)) ||
      !Array.isArray(aiSearch.steps) || aiSearch.steps.length < 5 || aiSearch.steps.length > 6 ||
      aiSearch.steps.some(step => !text(step?.query) || !Array.isArray(step.expected) || !step.expected.length)) {
    throw new Error('В demo.aiSearch укажите один раздел 1–4 и 5–6 реплик одного диалога с ожидаемыми ответами.');
  }
  if (new Set(aiSearch.steps.map(step => normalized(step.query))).size !== aiSearch.steps.length) {
    throw new Error('Реплики сценария ИИ-поиска должны различаться.');
  }
  const fragments = new Map(sources.map(({ key }) => {
    const article = pages.get(key);
    return [key, [article.intro, ...article.sections.flatMap(section => [section.title, section.text, ...(section.steps ?? [])])]];
  }));
  const usedSources = new Set();
  for (const [index, { expected }] of aiSearch.steps.entries()) {
    for (const source of expected) {
      const blocks = fragments.get(source?.key);
      if (!blocks || !Array.isArray(source.facts) || !source.facts.length) {
        throw new Error('Для реплики ' + (index + 1) + ' укажите статью из раздела ' + section + ' и факты ожидаемого ответа.');
      }
      if (source.facts.some(fact => !text(fact) || !blocks.some(fragment => normalized(fragment).includes(normalized(fact))))) {
        throw new Error('В реплике ' + (index + 1) + ' есть ожидаемый факт, которого нет в тексте статьи ' + source.key + '.');
      }
      usedSources.add(source.key);
    }
  }
  const unused = sources.filter(page => !usedSources.has(page.key)).map(page => page.key);
  if (unused.length) throw new Error('В сценарии ИИ-поиска должны участвовать все статьи раздела. Добавьте источники ' + unused.join(', ') + '.');
  if (!Array.isArray(aiSearch.synonyms) || !aiSearch.synonyms.length) {
    throw new Error('В demo.aiSearch.synonyms укажите пары слов или фраз из реплик и статей.');
  }
  const synonyms = aiSearch.synonyms.map(pair => {
    const { key, inQuery, inArticle } = pair ?? {};
    if (!text(inQuery) || !text(inArticle) || normalized(inQuery) === normalized(inArticle) ||
        !fragments.get(key)?.some(fragment => containsPhrase(fragment, inArticle))) {
      throw new Error('Укажите разные формулировки синонимов и проверьте, что «' + (inArticle ?? '') + '» есть в тексте статьи ' + (key ?? '') + '.');
    }
    const questions = aiSearch.steps.flatMap((step, index) =>
      step.expected.some(source => source.key === key) && containsPhrase(step.query, inQuery) ? [index + 1] : []);
    if (!questions.length) {
      throw new Error('Формулировка «' + inQuery + '» отсутствует в репликах, где источником служит ' + key + '.');
    }
    return { key, inQuery, inArticle, questions };
  });
  return {
    images: { folder: images.folder, index: images.index, links: Object.fromEntries(imageLinks) },
    aiSearch: { section, sources: sources.map(page => page.key), steps: aiSearch.steps, synonyms },
  };
}

export function duration(ms) {
  if (!Number.isFinite(ms)) return '—';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return [hours && hours + ' ч', (hours || minutes) && minutes % 60 + ' мин',
    (ms < 1000 ? (ms / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 }) : seconds % 60) + ' с']
    .filter(Boolean).join(' ');
}

export function timingSummary(run) {
  const attempts = run.attempts?.length ? run.attempts : [{ timingsMs: run.timingsMs }];
  const labels = {
    covers: 'Подготовка обложек в сборщике', space: 'Мастер и создание пространства',
    articlesTotal: 'Создание и оформление дерева', content: 'Суперстатья и три вложенные',
    workArticlesMs: 'Рабочие статьи', glossaryWrite: 'Заполнение глоссария',
    parallelWriteMs: 'Таблицы и курс в параллельных вкладках',
    tableContentMs: 'Наполнение и настройка таблиц', course: 'Создание и публикация курса', rightsWrite: 'Настройка прав',
    verify: 'Итоговая проверка статей, карточек и прав', settings: 'Итоговая проверка модулей и глоссария',
    tableVerificationMs: 'Итоговая проверка таблиц', courseVerificationMs: 'Итоговая проверка курса',
  };
  const stages = Object.entries(labels).flatMap(([key, label]) => {
    const values = attempts.map(({ timingsMs }) => {
      if (Number.isFinite(timingsMs?.parallelWriteMs) && ['tableContentMs', 'course'].includes(key)) return;
      return timingsMs?.[key];
    }).filter(Number.isFinite);
    return values.length ? [{ label, ms: values.reduce((sum, value) => sum + value, 0) }] : [];
  });
  const measured = stages.reduce((sum, item) => sum + item.ms, 0);
  if (run.cliMs > measured) stages.push({ label: 'Запуск браузера, ожидания и незавершённые шаги', ms: run.cliMs - measured });
  if (Number.isFinite(run.preflightMs)) stages.unshift({ label: 'Подготовка и проверка входного плана', ms: run.preflightMs });
  const parallel = Object.entries({ tableContentMs: 'Таблицы', course: 'Курс' }).flatMap(([key, label]) => {
    const values = attempts.filter(attempt => Number.isFinite(attempt.timingsMs?.parallelWriteMs))
      .map(attempt => attempt.timingsMs[key]).filter(Number.isFinite);
    return values.length ? [{ label, ms: values.reduce((sum, value) => sum + value, 0) }] : [];
  });
  return { totalMs: run.elapsedMs, stages, parallel };
}

function answer(test) {
  if (test.answers) return test.answers.filter(option => option.correct).map(option => option.text).join(' · ');
  if (test.items) return test.items.join(' → ');
  if (test.pairs) return test.pairs.map(([left, right]) => left + ' → ' + right).join(' · ');
  return test.expected;
}

export function demoReport({ plan, run, demo, work, content, tables, course }) {
  const state = run.machineState ?? run.state ?? {};
  const objects = state.objects ?? run.pages ?? {};
  const byKey = new Map(plan.pages.map(page => [page.key, page]));
  const workByKey = new Map((work?.articles ?? []).map(article => [article.key, article]));
  const tableByKey = new Map((tables ?? []).map(table => [table.key, table]));
  const compact = value => String(value ?? '').replace(/[|\r\n]/gu, ' ').trim();
  const link = (label, url) => url ? '[' + compact(label).replace(/[[\]]/gu, '\\$&') + '](<' + url + '>)' : compact(label);
  const pageLink = key => link(byKey.get(key)?.title ?? key, objects[key]?.url);
  const time = timingSummary(run);
  const status = run.complete ? 'Сборка подтверждена' : run.mode === 'checkpoint' ? 'Остановка на указанном шаге' : 'Сборка не подтверждена';
  const lines = [
    '# Отчёт о сборке «' + plan.title + '»', '', '**' + status + '. Общее время — ' + duration(time.totalMs) + '.**',
    '', link('Пространство Teamly', objects.space?.url ?? run.space),
  ];
  if (run.reason) lines.push('', 'Причина остановки — ' + compact(run.attempts?.at(-1)?.reason ?? run.reason) + '.');
  lines.push('', '## Время по этапам', '', '| Этап | Время |', '|---|---:|',
    ...time.stages.map(({ label, ms }) => '| ' + label + ' | ' + duration(ms) + ' |'),
    '', 'Замер начинается с запуска сборщика. Подготовка материалов до запуска в него не входит.');
  if (time.parallel.length) {
    lines.push('', 'В параллельном этапе — ' + time.parallel.map(({ label, ms }) => label.toLowerCase() + ' ' + duration(ms)).join(', ') + '.');
  }
  const failedAttempts = (run.attempts ?? []).filter(attempt => !attempt.ok);
  if (failedAttempts.length) {
    lines.push('', 'Повторные шаги учтены в общем времени.', '',
      ...failedAttempts.flatMap(attempt => [
        '- ' + compact(attempt.stage ?? 'Сверка') + ' — ' + compact(attempt.reason ?? 'остались неподтверждённые шаги'),
        ...(attempt.details ?? []).map(detail => '  - ' + compact(detail)),
      ]));
  }

  const show = {
    ROOT: 'Откройте большие карточки, переходы к разделам и панель «Доступ».',
    SUPER: 'Покажите ' + (content?.primary?.headings?.join(', ') || 'иллюстрации, глоссарий и виджеты') + ' и карточки вложенных статей.',
  };
  const layouts = new Map((content?.nested?.pages ?? []).map(page => [page.key, page.layout]));
  const showcase = {
    program: 'Покажите таблицу контрольных точек и чек-лист.',
    preparation: 'Покажите вложения и встроенную опубликованную таблицу.',
    finish: 'Покажите Mermaid и схемы Draw.io.',
  };
  const tally = (label, match) => {
    const planned = plan.pages.filter(match);
    return label + ' — ' + planned.filter(page => objects[page.key]?.url).length + ' из ' + planned.length;
  };
  lines.push('', '## Что создано и что показывать', '',
    tally('Статьи', page => page.kind !== 'database') + '. ' + tally('ТБД', page => page.kind === 'database') + '.',
    '',
    '| Объект | Где | Что показать | Статус |', '|---|---|---|---|');
  for (const page of plan.pages) {
    const object = objects[page.key];
    const article = workByKey.get(page.key);
    const table = tableByKey.get(page.key);
    const views = table?.views?.map(view => {
      const found = state.tableContent?.extras?.views?.find(saved => saved.key === page.key && saved.name === view.name);
      const features = [view.group && 'группировка по «' + view.group + '»', view.format && 'условное форматирование',
        view.color && 'цвет по «' + view.color + '»'].filter(Boolean);
      return link(view.name, found?.url) + (features.length ? ' (' + features.join(', ') + ')' : '');
    });
    const demonstration = demo?.aiSearch.section === page.key ? 'Откройте раздел с инструкциями для ИИ-поиска.' :
      demo?.aiSearch.sources.includes(page.key) ? 'Источник для диалога в ИИ-чате.' :
      show[page.key] ?? showcase[layouts.get(page.key)] ?? (table ? [
        'Откройте запись «' + table.rows[0].title + '»',
        views?.length ? 'Переключите представления ' + views.join(', ') : '',
      ].filter(Boolean).join('. ') :
        article?.panel ? 'Покажите «' + article.panel.title + '» и «' + article.sections[0].title + '».' : 'Откройте материалы раздела.');
    const expectsBody = article || page.key === 'SUPER' || layouts.has(page.key);
    const confirmed = object && Object.keys(object.checks ?? {}).length && Object.values(object.checks).every(Boolean) &&
      (!expectsBody || state.content?.[page.key]?.verification) &&
      (page.key !== 'ROOT' || (state.cards?.verified && (!plan.rights.length || state.rights?.status === 'назначения проверены')));
    lines.push('| ' + [pageLink(page.key), page.parent ? pageLink(page.parent) : 'Пространство',
      compact(demonstration), confirmed ? 'проверено' : object?.url ? 'создано, ожидает сверки' : 'ожидает создания'].join(' | ') + ' |');
  }
  const space = objects.space?.url ?? run.space;
  if (state.modules?.length) lines.push('', link('Настройки пространства', space && space + '/settings/main') +
    ' — покажите ' + state.modules.join(', ') + '.');
  if (state.glossary?.length) lines.push(link('Глоссарий', space && space + '/glossary/articles') +
    ' — покажите ' + state.glossary.join(', ') + '.');
  const savedCourse = run.course?.url ? run.course : state.course ?? state.courseWrite;
  if (course) {
    lines.push('', 'Курс — ' + link(course.title, savedCourse?.url) + (savedCourse?.url ? '. Покажите модули и порядок материалов.' : ' (запланирован).'));
  }

  if (demo) {
    lines.push('', '## Картинки', '', [link('Реестр картинок', demo.images.index),
      demo.images.folder && link('Папка Google Drive', demo.images.folder)].filter(Boolean).join(' · '), '');
    const faq = state.content?.SUPER?.verification?.images?.[1];
    if (content?.primary?.assets?.presentation === 'full-width-faq' && faq) {
      lines.push('Полоса «Частые вопросы» в Teamly — ' + faq.width + ' × ' + faq.height + ' px. Ширина блока — ' + faq.frameWidth + ' px.', '');
    }
    if (course?.coverScenes?.length) lines.push('Обложка курса по порядку слева направо — ' +
      course.coverScenes.map(({ description }) => compact(description).replace(/\.$/u, '')).join(' → ') + '.', '');
    for (const [key, url] of Object.entries(demo.images.links)) {
      const name = byKey.has(key) ? 'Обложка «' + byKey.get(key).title + '»' :
        key === 'COURSE' ? 'Обложка курса' : 'Иллюстрация ' + key.at(-1) + ' в суперстатье';
      lines.push('- ' + link(name, url));
    }
  }

  if (course) {
    lines.push('', '## Ответы на тесты курса', '', 'Ключ для ведущего демо.', '');
    for (const material of course.materials) {
      lines.push('### ' + compact(material.module), '', 'Материал — ' + pageLink(material.key) + '.', '');
      for (const test of material.tests) {
        const entry = savedCourse?.order?.find(item => item.kind === 'test' && item.title === test.title);
        lines.push('- **' + link(test.title, entry?.url) + '** · ' + test.type,
          '  - Вопрос — ' + compact(test.prompt),
          '  - ' + (test.type === 'Открытый ответ' ? 'Пример полного ответа' : 'Правильный ответ') + ' — ' + compact(answer(test)));
      }
      lines.push('');
    }
  }
  if (demo) {
    lines.push('', '## Сценарий поиска через ИИ', '', 'Раздел с инструкциями — ' + pageLink(demo.aiSearch.section) + '.',
      'Источники — ' + demo.aiSearch.sources.map(pageLink).join(', ') + '.',
      'Откройте один ИИ-чат и отправляйте реплики по порядку в нём же. После каждого ответа сверьте факты и откройте источник.',
      'Ожидаемые ответы сверены с текстами статей. Результат поиска проверяется на демо.', '');
    for (const [index, step] of demo.aiSearch.steps.entries()) {
      lines.push((index + 1) + '. **Реплика** — ' + compact(step.query));
      for (const source of step.expected) {
        lines.push('   - **Должно найти** — ' + pageLink(source.key) + '.',
          '   - **Что должно быть в ответе** — ' + source.facts.map(compact).join(' · ') + '.');
      }
    }
    lines.push('', '### Синонимы в диалоге и инструкциях', '', '| В реплике | В тексте статьи | Реплики | Источник |', '|---|---|---|---|');
    for (const { key, inQuery, inArticle, questions } of demo.aiSearch.synonyms) {
      lines.push('| ' + [compact(inQuery), compact(inArticle), questions.join(', '), pageLink(key)].join(' | ') + ' |');
    }
  }
  return lines.join('\n').trimEnd() + '\n';
}
