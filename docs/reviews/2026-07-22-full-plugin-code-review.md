# Полное код-ревью vite-webp-avif-generator-plugin

Дата: 2026-07-22  
Проверенное состояние: ветка `v2.4.0`, текущее dirty working tree, Node `24.14.0`, npm `11.9.0`, Vite `8.0.3`, Sharp `0.34.5`, chokidar `4.0.3`.

## Итог

Плагин компактный, читаемый и в основной логике соответствует Vite Plugin API. Хорошо реализованы dev-only scope, разрешение `root`/`publicDir`, работа через Vite logger, исключения, initial pass, раздельная обработка ошибок форматов и атомарная публикация target-файла. Типы, runtime и README для публичных опций синхронизированы; npm tarball корректен.

Общая оценка: **7/10**. Для выпуска рекомендуется сначала закрыть допуск уязвимых Sharp-версий, коллизии target-имён и lifecycle активных конверсий. Тестовая база содержательная, но release gate сейчас не воспроизводим полностью и не автоматизирован.

## Подтверждённые находки

### P1 — manifest допускает Sharp с известными high-severity уязвимостями

**Место:** `package.json:48-50`, `README.md:198-200`.

Зависимость разрешает Sharp `0.32`, `0.33` и `0.34`; текущее окружение фактически использует `sharp@0.34.5`. `npm audit --omit=dev` вернул exit code `1` и одну high-severity direct vulnerability. GitHub Advisory указывает affected range `<0.35.0`, patched version `0.35.0` и риск при обработке недоверенного input: [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj).

Практический путь существует: плагин автоматически отправляет в Sharp каждый файл с поддерживаемым расширением из watched folder; формат содержимого Sharp определяет сам, поэтому вредоносный файл в недоверенной ветке/архиве может попасть в decoder при запуске dev-сервера. Это локальный, а не сетевой сценарий, но он реалистичнее абстрактного edge case для инструмента разработки.

**Направление исправления:** перестать разрешать Sharp `<0.35.0`, обновить локальную проверочную версию/lock state, README и changelog; добавить `npm audit --omit=dev` в release verification.

### P2 — разные исходники молча перезаписывают общий target

**Место:** `vite-webp-avif-generator-plugin.js:197-221`, `vite-webp-avif-generator-plugin.js:270-282`, `vite-webp-avif-generator-plugin.js:446-450`, `vite-webp-avif-generator-plugin.js:544-547`.

`getTargetPath()` удаляет исходное расширение: `logo.png` и `logo.jpg` оба пишут `logo.webp`/`logo.avif`. Initial pass запускает файлы параллельно, а target-level lock/ownership отсутствует; обе задачи проходят `existsSync()` и обе rename-операции считаются успешными. В пяти из пяти прогонов summary был `processed 2, converted 4, failed 0`, хотя на диске оставались только два target и оба содержали данные последнего источника. Предупреждения нет.

Та же архитектурная причина удваивает работу для повторяющихся/пересекающихся `folders`: один файл с `folders: ['img', 'img']` дал `processed 2, converted 4`.

Это практический correctness-риск для репозиториев, где рядом лежат JPG/PNG варианты одного ассета. Внутренний `docs/roadmap/02-output-name-collisions.md` уже правильно описывает проблему, но решение ещё не реализовано и ограничение отсутствует в README.

**Направление исправления:** ввести collision-free naming opt-in/default strategy либо детерминированное владение target с обязательным warning; отдельно дедуплицировать абсолютные source paths перед initial pass. Добавить интеграционный тест с визуально различимыми `logo.png`/`logo.jpg`.

### P2 — `server.close()` не ждёт уже запущенную обработку

**Место:** `vite-webp-avif-generator-plugin.js:97-107`, `vite-webp-avif-generator-plugin.js:113-124`, `vite-webp-avif-generator-plugin.js:134-147`.

Callbacks chokidar и `runInitialPass()` запускаются без реестра активных promises; close wrapper ждёт только `watcher.close()`, затем вызывает оригинальный Vite `close()`. Диагностический прогон с большим PNG показал: `await server.close()` вернулся за `3ms`, watcher сообщил остановку, а `large.webp` был создан примерно через `1.2s`; AVIF-задача продолжала удерживать процесс существенно дольше.

Практическое влияние: programmatic shutdown сообщает о завершении до последней файловой мутации; при `server.restart()` старая и новая initial pass могут одновременно кодировать одни targets и создавать лишнюю CPU/memory нагрузку. При завершении процесса остаётся риск temp-файлов от прерванных задач.

Официальный Vite API подтверждает `close(): Promise<void>` у `ViteDevServer` и то, что `configureServer` return callback является post-middleware hook, а не shutdown callback: [JavaScript API](https://vite.dev/guide/api-javascript.html), [Plugin API](https://vite.dev/guide/api-plugin.html). Поэтому текущая обёртка watcher cleanup практически работоспособна, но должна учитывать активные операции.

**Направление исправления:** локально для каждого server instance отслеживать все active handler/initial-pass promises и при close либо корректно отменять, либо дожидаться их до вызова/завершения original close; добавить медленный lifecycle test на close и restart.

### P2 — обязательный race-test стабильно ложно падает

**Место:** `playground/scripts/test-race-initial-pass.mjs:113-137`, `playground/scripts/test-race-initial-pass.mjs:163-167`, `PUBLISHING.md:8-24`.

Два последовательных запуска дали `4/5` и exit code `1`. При этом файл действительно добавлен во время initial pass, watcher его обнаружил, а WebP и AVIF созданы. Падает только требование `raceIdx < summaryIdx`.

Корневая причина: watcher настроен с `awaitWriteFinish.stabilityThreshold: 300`; событие `add` законно откладывается, а быстрый initial pass успевает вывести summary. README обещает, что добавленный файл не будет потерян, но не обещает порядок этих логов. `PUBLISHING.md` требует от этого скрипта exit code `0`, поэтому документированный release checklist сейчас нельзя пройти на обычном Windows-окружении.

**Направление исправления:** проверять итоговую доставку события и создание targets, а не порядок логов; если важна одновременная дедупликация live/initial, создать отдельный тест числа фактических conversion attempts.

### P3 — live/initial лог считает `skipped` как «Successfully converted»

**Место:** `vite-webp-avif-generator-plugin.js:224-240`.

`successful` считает все fulfilled promises, включая результат `"skipped"`. На идемпотентном повторном старте summary корректно сообщил `converted 0, skipped 15`, но каждый файл вывел `Successfully converted: 2 format(s)`. Та же ошибка возникает при live add с уже существующими targets.

Это не портит файлы, но систематически искажает диагностику обычного restart-сценария.

**Направление исправления:** логировать отдельно фактические `converted` и `skipped` из tally, а не число fulfilled promises; закрепить проверкой согласованности per-file log и summary.

### P3 — зелёный format-options test оставляет scratch на Windows

**Место:** `playground/scripts/test-format-options.mjs:211-240`, `playground/scripts/test-format-options.mjs:273-278`.

Два запуска дали `17/17`, но после каждого оставался `playground/.format-options-scratch/webp-source-avif-only/public/img/sample.webp`. Финальный catch полностью скрывает cleanup failure. Наблюдаемая причина — Windows file handle/cache Sharp после прямого чтения `sample.webp`; фиксированная задержка и короткий retry не обеспечивают очистку.

**Направление исправления:** сделать cleanup проверяемым (или явно reported), не читать removable fixture способом, оставляющим cached handle, либо управлять Sharp cache в изолированном тесте. Добавить postcondition `!existsSync(scratchRoot)`.

### P3 — release verification не является частью package scripts, а checklist игнорируется Git

**Место:** `package.json:55-57`, `.gitignore:35-37`, `PUBLISHING.md`.

`prepublishOnly` только печатает `Ready to publish!`; `test`/`verify` script отсутствует. Одновременно глобальное `*.md` игнорирует `PUBLISHING.md` и `docs/**/*.md`; `git check-ignore -v` подтвердил это, а `git ls-files` не содержит `PUBLISHING.md`. То есть обязательные ручные команды не запускаются при публикации, а сам checklist не является частью истории репозитория, несмотря на его роль в `AGENTS.md`.

В сочетании с текущим ложнопадающим race-test и пропущенным audit это реальный процессный риск выпуска.

**Направление исправления:** добавить единый `npm run verify` и вызывать его из CI/prepublish; разрешить tracking `PUBLISHING.md` и нужных `docs/` через точечные правила `.gitignore`.

## Сверка с Vite

Проверено по актуальной документации Vite 8.1.5 и versioned docs Vite 4:

- `apply: 'serve'` корректно ограничивает плагин dev server mode.
- `configResolved` предназначен для чтения итогового `ResolvedConfig`; сохранение `root`, `publicDir`, `logger` соответствует API.
- `configureServer` корректен для установки watcher; возвращаемая функция не является cleanup dev server, поэтому отказ от неё для shutdown обоснован.
- `ViteDevServer.httpServer` действительно `null` в middleware mode; закрытие только через HTTP event было бы неверно.
- `ViteDevServer.close()` имеет `Promise<void>`; wrapping метода проходит текущие in-process tests, но Vite не документирует его как специальную extension point, поэтому lifecycle test остаётся важным.
- `root` default/semantics, `publicDir: string | false`, `logLevel`, `customLogger` и `clearScreen` согласованы с кодом/README: [Shared Options](https://vite.dev/config/shared-options.html).
- `normalizePath` экспортируется Vite и рекомендован для межплатформенного сравнения путей; это было так уже в [Vite 4 Plugin API](https://v4.vite.dev/guide/api-plugin.html).

Nuxt-утверждение README также согласуется с актуальным config reference: Nuxt указывает `vite.publicDir` default `false` и Vite root от `srcDir`: [Nuxt Configuration](https://nuxt.com/docs/3.x/api/nuxt-config).

Локально проверен Vite `8.0.3`. Реальные Nuxt 3/4 приложения в этом прогоне не запускались: их `node_modules` отсутствуют; выполнены предоставленные Nuxt-like in-process сценарии. Совместимость Vite 4–7 подтверждена статическим API-сопоставлением, а не матрицей runtime-тестов в этой сессии.

## Документация и публичный API

### Соответствует

- Все семь runtime-опций совпадают по имени, default и смыслу между JSDoc, `.d.ts` и README.
- `webpOptions`/`avifOptions` действительно передаются Sharp без преобразования и работают в initial/live paths.
- WebP source не перекодируется в WebP и использует только `avifOptions` для AVIF sibling.
- Existing target не изменяется; README ясно сообщает о необходимости удалить его для regeneration.
- Dev-only behavior, input/output formats, exclude и missing-folder warning описаны корректно.
- Версия `2.4.0` синхронизирована между `package.json`, локальным lockfile и changelog.
- `main`/`types`/`exports` корректны для ESM import; import smoke прошёл.
- `npm pack --dry-run --json` включил ровно шесть ожидаемых файлов: package metadata, runtime, declarations, README, changelog и license.

### Нужно дополнить

- README не предупреждает о same-basename collision и overlapping/duplicate folders.
- README не описывает, что активная конвертация может пережить `server.close()`.
- Compatibility section должен исключить Sharp `<0.35.0` после security update.
- Publishing notes должны включать audit и реальный единый verify command.

## Выполненные проверки

| Проверка | Результат |
| --- | --- |
| `node --check vite-webp-avif-generator-plugin.js` | exit `0` |
| `test-format-options.mjs` | `17/17`, два раза; оба раза остался scratch |
| `run-tests.mjs` | `39/39` |
| `test-logging.mjs` | `16/16` |
| `test-nuxt-srcdir-public.mjs` | `10/10` |
| `test-nuxt-watcher-cleanup.mjs` | `6/6` |
| `test-race-initial-pass.mjs` | `4/5`, два раза; exit `1` |
| `npm pack --dry-run --json` | exit `0`, 6 файлов |
| import/package smoke | exit `0` |
| `npm audit --omit=dev --json` | exit `1`, 1 high vulnerability в Sharp |
| same-basename diagnostic | silent overwrite `5/5` |
| duplicate-folder diagnostic | `processed 2, converted 4` для одного source |
| active-close diagnostic | close `3ms`, WebP записан после close |

Symlink case в основном suite пропущен на Windows из-за отсутствия privilege (`EPERM`). Реальный Linux symlink path в этой сессии не проверен.

## Оценка по направлениям

| Направление | Оценка | Обоснование |
| --- | ---: | --- |
| Читаемость и структура | 8/10 | Маленькие функции, понятный поток, ESM без лишней абстракции |
| Vite-интеграция | 8/10 | Hooks/logger/publicDir корректны; active-work lifecycle не завершён |
| Корректность файловой логики | 6/10 | Atomic target write хорош; target collisions и отсутствие дедупликации существенны |
| Публичные типы/API | 9/10 | Runtime, JSDoc, `.d.ts`, README синхронизированы |
| Документация | 8/10 | Подробная и практичная; не описывает подтверждённые collision/lifecycle ограничения |
| Тестовая зрелость | 6/10 | Хорошее покрытие сценариев, но нет единого gate, один обязательный test ложнопадает, cleanup скрыт |
| Dependency/release hygiene | 5/10 | Уязвимый разрешённый Sharp range, audit отсутствует, checklist ignored/unforced |

## Рекомендуемый порядок исправлений

1. Ограничить Sharp версией `>=0.35.0`, прогнать audit и compatibility tests.
2. Реализовать collision policy + source deduplication и документировать naming contract.
3. Привязать active conversion promises к lifecycle каждого Vite server instance.
4. Исправить race-test invariant; затем собрать все проверки в `npm run verify`/CI/prepublish.
5. Исправить misleading success count.
6. Сделать Windows scratch cleanup проверяемым и tracked publishing docs доступными в Git.

Runtime-код, типы и пользовательская документация в рамках этого ревью не исправлялись.
