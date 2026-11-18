const marks = {
  guide: ['📋', 'планшет'], search: ['🔍', 'лупа'], tools: ['🔧', 'гаечный ключ'],
  chart: ['📊', 'гистограмма'], progress: ['📈', 'диаграмма роста'],
};

const article = (key, parent, title, mark, icon) => {
  const [emoji, emojiName] = marks[mark];
  return { key, parent, title, emoji, emojiName, icon };
};
const table = (key, parent, title) => ({ key, parent, title, kind: 'database' });

export const learning = {
  host: 'https://sdemo.teamly.ru',
  title: 'Учебный центр',
  description: 'Обучение сотрудников, развитие навыков и методические материалы для наставников.',
  audience: 'сотрудники, наставники и организаторы корпоративного обучения',
  coverSubtitle: ['Обучение сотрудников', 'и развитие навыков'],
  structureOnly: true,
  coverStyle: 'hr-reference',
  modules: ['Глоссарий', 'Быстрые ссылки', 'Связанный диск', 'Свойства'],
  glossary: [
    { term: 'Учебная программа', definition: 'Набор курсов и практических заданий, объединённых общей целью обучения.' },
    { term: 'Учебная траектория', definition: 'Последовательность шагов обучения для роли или конкретного сотрудника.' },
    { term: 'Практическое задание', definition: 'Задача, на которой сотрудник применяет полученные знания и демонстрирует навык.' },
    { term: 'Наставник', definition: 'Сотрудник, который помогает освоить рабочие задачи и даёт обратную связь по практике.' },
    { term: 'Итоговая оценка', definition: 'Проверка результатов обучения по заранее указанным критериям.' },
  ],
  pages: [
    article('ROOT', null, 'Учебный центр', 'guide', 'people'),
    article('SUPER', 'ROOT', 'Путь сотрудника в обучении', 'progress', 'route'),
    article('SUPER-1', 'SUPER', 'Выбор программы и постановка цели', 'search', 'target'),
    article('SUPER-2', 'SUPER', 'Прохождение курса и практика', 'guide', 'book'),
    article('SUPER-3', 'SUPER', 'Итоговая оценка и план развития', 'chart', 'award'),
    table('SUPER-TBD', 'ROOT', 'Реестр обучения сотрудников'),
    article('SEC-05', 'ROOT', 'Инструменты учебного центра', 'tools', 'toolkit'),
    table('TBD-1', 'SEC-05', 'Каталог курсов'),
    table('TBD-2', 'SEC-05', 'Календарь учебных мероприятий'),
    table('TBD-3', 'SEC-05', 'Банк практических заданий'),
    table('TBD-4', 'SEC-05', 'Реестр наставников'),
    article('SEC-01', 'ROOT', 'Программы и курсы', 'guide', 'books'),
    article('SEC-01-1', 'SEC-01', 'Как выбрать курс', 'search', 'search'),
    article('SEC-01-2', 'SEC-01', 'Вводное обучение сотрудников', 'guide', 'door'),
    article('SEC-01-3', 'SEC-01', 'Профессиональное развитие по ролям', 'progress', 'steps'),
    article('SEC-02', 'ROOT', 'Организация обучения', 'guide', 'calendar'),
    article('SEC-02-1', 'SEC-02', 'Планирование учебного потока', 'guide', 'checklist'),
    article('SEC-02-2', 'SEC-02', 'Запись и подтверждение участия', 'guide', 'ticket'),
    article('SEC-02-3', 'SEC-02', 'Сопровождение участников', 'tools', 'chat'),
    article('SEC-03', 'ROOT', 'Материалы для наставников', 'tools', 'mentor'),
    article('SEC-03-1', 'SEC-03', 'Подготовка практического занятия', 'guide', 'screen'),
    article('SEC-03-2', 'SEC-03', 'Разбор задания и обратная связь', 'search', 'chat'),
    article('SEC-03-3', 'SEC-03', 'Наблюдение за работой сотрудника', 'search', 'eye'),
    article('SEC-04', 'ROOT', 'Оценка и развитие навыков', 'chart', 'chart'),
    article('SEC-04-1', 'SEC-04', 'Критерии итоговой оценки', 'guide', 'checklist'),
    article('SEC-04-2', 'SEC-04', 'Индивидуальная траектория развития', 'progress', 'route'),
    article('SEC-04-3', 'SEC-04', 'Анализ результатов обучения', 'chart', 'chart'),
  ],
};
