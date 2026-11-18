# Сборщики пространства Teamly

В репозитории два сборщика и [навык Codex](SKILL.md). Сборщики запускаются из терминала через Node.js.

| Что собираем | Файл | Пример |
| --- | --- | --- |
| Каркас пространства с корневой статьёй и пятью разделами либо отдельные статьи и таблицы | [teamly-code.mjs](teamly-superarticle/scripts/teamly-code.mjs) | [Каркас пространства](teamly-superarticle/examples/code-mode/space.json) и [статья с таблицей](teamly-superarticle/examples/code-mode/content.json) |
| Полный демохост с обложками, суперстатьёй, рабочими статьями, умными таблицами и курсом | [teamly-space-pilot.mjs](teamly-space-pilot.mjs) | [Учебный комплект](examples/full-demo) |

## Установка на другом компьютере

Нужны Node.js 20 или новее с npm, Google Chrome и доступ к нужному Teamly. Сборщики используют команды русскоязычного интерфейса. Для полной сборки нужны права на создание пространства, публикацию статей и курса, а также доступ к модулям и папке курсов из плана.

Откройте этот приватный репозиторий под своим аккаунтом GitHub с доступом и скачайте архив через **Code → Download ZIP**. Если настроен Git, можно клонировать репозиторий.

```shell
git clone https://github.com/Tevuto/teamly-create-space.git
cd teamly-create-space
```

Откройте терминал в корне распакованного или клонированного репозитория и установите зависимости. Все команды ниже выполняются из этого каталога.

```shell
npm ci
```

## Каркас пространства

Скопируйте [space.json](teamly-superarticle/examples/code-mode/space.json) в `runs/frame/plan.json`. В `space.list` укажите адрес списка пространств на своём хосте Teamly и задайте название и содержание. Для работы в существующем пространстве задайте его адрес в `space.url`. Параметр `space.create: true` разрешает создать пространство, если совпадение по названию не найдено.

```shell
node teamly-superarticle/scripts/teamly-code.mjs check runs/frame/plan.json
node teamly-superarticle/scripts/teamly-code.mjs sign-in runs/frame/plan.json --profile .teamly-frame-profile
node teamly-superarticle/scripts/teamly-code.mjs build runs/frame/plan.json --profile .teamly-frame-profile --state runs/frame/build.state.json
node teamly-superarticle/scripts/teamly-code.mjs verify runs/frame/plan.json --profile .teamly-frame-profile --state runs/frame/build.state.json
```

Войдите в Teamly в окне Chrome, которое открывает `sign-in`. Команда `check` проверяет план локально. `build` создаёт и наполняет объекты, а `verify` сверяет сохранённый результат. Пункты `manual` в других планах выполните в редакторе по указаниям отчёта. Для каркаса обложки, эмодзи и формат карточек можно настроить после сборки. [Формат плана](teamly-superarticle/references/code-mode.md) · [Маршруты редактора](references/recorded-space-ui.md)

## Полный демохост

Скопируйте весь каталог [examples/full-demo](examples/full-demo) в `runs/full`, сохранив структуру папок. В шаблоне есть 22 статьи, семь умных таблиц, обложки, вложения и курс. Перед рабочим запуском настройте файлы под свой Teamly.

| Что настроить | Где |
| --- | --- |
| HTTPS-адрес Teamly в `host`, название, дерево и глоссарий | `plan.json` |
| Ссылка на реестр картинок Google Drive в `demo.images.index`, при наличии ссылка на папку в `demo.images.folder`, источники сценария ИИ в `demo.aiSearch` | `plan.json` |
| Опубликованная ссылка Google Таблиц вида `https://docs.google.com/spreadsheets/d/e/…/pubhtml` в `googleSheet` у `SUPER-2`, тексты, вложения и диаграммы | `content.json` |
| Тексты рабочих статей и данные умных таблиц | `articles.json` и `tables.json` |
| Название существующей папки курсов в `folder`, обложка, статьи и тесты | `course.json` |
| Обложки PNG размером 2500 × 500, по одному файлу на ключ статьи | `covers/` |

Учебный адрес `teamly.example` и ссылки с `REPLACE_WITH_…` подходят для локальной проверки. Для сборки подставьте действующие адреса. Пути к вложениям в JSON считаются от папки этого файла. Если нужны назначения доступа на корневой статье, заполните `rights` в плане или передайте отдельную матрицу через `--rights`. [Настройка доступа](references/access.md)

Сначала проверьте весь набор.

```shell
node teamly-space-pilot.mjs check --plan runs/full/plan.json --covers runs/full/covers --content runs/full/content.json --articles runs/full/articles.json --tables runs/full/tables.json --course runs/full/course.json
```

Поменяйте `https://teamly.example` в следующей команде на тот же хост, который указали в `plan.json`. Войдите в Teamly в открывшемся Chrome и оставьте это окно открытым. Затем запустите сборку в той же именованной сессии.

```shell
npm exec -- playwright-cli -s=teamly-full open https://teamly.example/space/list/all --browser=chrome --headed --persistent --profile=.teamly-full-profile
node teamly-space-pilot.mjs build --plan runs/full/plan.json --covers runs/full/covers --content runs/full/content.json --articles runs/full/articles.json --tables runs/full/tables.json --course runs/full/course.json --session teamly-full --state runs/full/build.state.json --report runs/full/report.json
```

Результаты сборки появятся в `runs/full/report.md` и `runs/full/report.json`. При прерывании сохраните тот же план, профиль браузера и файл состояния. Если окно Chrome закрыто, откройте его той же командой и повторите запуск с теми же аргументами. Когда работа завершена, закройте сессию командой `npm exec -- playwright-cli -s=teamly-full close`.

Профили сохраняют вход в Teamly на компьютере, где вы их создали. На другом компьютере войдите заново. Каталог `runs/` предназначен для ваших материалов, отчётов и файлов состояния.
