# Full Plugin Code Review Plan

> **For agentic workers:** execute the checks in order, record evidence before conclusions, and do not change runtime behavior while performing the review.

**Goal:** провести полное ревью текущего состояния `vite-webp-avif-generator-plugin`: runtime-кода, Vite-интеграции, типов, тестовых сценариев, package metadata и пользовательской документации.

**Approach:** сначала зафиксировать фактическое состояние репозитория и официальный контракт Vite, затем проверить ключевые пользовательские потоки статически и динамически. Находки ранжировать только по реальному влиянию и вероятности в обычной разработке; маловероятные edge cases не включать в основные дефекты.

**Tech stack:** Node.js ESM, Vite 4–8, chokidar 3–5, Sharp 0.32–0.35, TypeScript declarations, PowerShell test runner.

## Global constraints

- Анализировать текущее рабочее дерево, включая уже существующие незакоммиченные изменения пользователя.
- Не исправлять найденные дефекты без отдельного запроса: результат этой работы — план, проверка и отчёт.
- Сверять Vite API только с актуальными официальными страницами документации и официальными типами/исходниками Vite.
- Для каждого замечания указывать файл и точную строку, наблюдаемое поведение, обычный практический сценарий, влияние и способ проверки.
- Severity определять как сочетание влияния и вероятности: `P1` — серьёзная поломка типового сценария, `P2` — заметный дефект распространённого сценария, `P3` — локальный дефект качества/документации с ограниченным влиянием.
- Не повышать severity для теоретических гонок, экстремальных входов и неподдерживаемой конфигурации без воспроизводимого пользовательского риска.

---

### Task 1: Зафиксировать baseline и область ревью

**Files:**
- Inspect: `package.json`, `.gitignore`, все tracked-файлы runtime/docs/playground
- Preserve: существующие изменения в `CHANGELOG.md`, `README.md`, `package.json`, `playground/scripts/test-format-options.mjs`

- [ ] Запустить `git status --short`, `git diff --stat`, `git log -5 --oneline --decorate` и записать ветку/dirty state.
- [ ] Получить список tracked и фактически присутствующих файлов; отдельно отметить игнорируемые `package-lock.json`, `PUBLISHING.md`, `docs/**/*.md`.
- [ ] Проверить версии Node/npm и фактически установленные версии Vite, Sharp и chokidar через `npm ls --depth=0`.
- [ ] Сопоставить фактическую структуру с `AGENTS.md` и определить, какие playground-сценарии входят в проверку.

**Deliverable:** точный baseline без изменения пользовательских файлов.

### Task 2: Проверить официальный контракт Vite

**Files:**
- Review: `vite-webp-avif-generator-plugin.js:31-150`
- Review: `vite-webp-avif-generator-plugin.d.ts`
- Review: `README.md`

- [ ] Открыть актуальную официальную документацию Vite по Plugin API: `apply`, `configResolved`, `configureServer`, lifecycle dev-сервера.
- [ ] Открыть официальную документацию Vite по `root`, `publicDir`, `logLevel`, `clearScreen` и Node API `ViteDevServer`/`Logger`.
- [ ] При неясности документации проверить официальный `vite` type declaration/source установленной версии, особенно сигнатуру `server.close()` и lifecycle закрытия.
- [ ] Сопоставить каждый используемый Vite hook и тип с официальным контрактом; отдельно оценить обёртку `server.close` и поведение в middleware/Nuxt.
- [ ] Проверить заявления README о Vite 4–8, dev-only поведении, publicDir и логировании.

**Deliverable:** таблица «утверждение/код → официальный контракт Vite → соответствует/не соответствует» со ссылками.

### Task 3: Провести статическое ревью runtime-логики

**Files:**
- Review: `vite-webp-avif-generator-plugin.js:31-562`

- [ ] Проследить полный поток `convertImages → configResolved → configureServer → add/ready → handleFileAdd → convertImage`.
- [ ] Проверить разрешение `folders`, `exclude`, абсолютных путей, `publicDir=false`, кастомного publicDir и Windows case-insensitive сравнений.
- [ ] Проверить фильтрацию расширений, исключения, generated-file loop prevention и правила для WebP-источника.
- [ ] Проверить построение target path для `.jpg`, `.jpeg`, `.png`, `.webp`, включая одинаковый basename у нескольких исходников.
- [ ] Проверить TOCTOU вокруг `existsSync`, атомарную temp-write/rename схему, очистку temp-файлов и параллельные add/initial-pass события.
- [ ] Проверить bounded concurrency относительно числа CPU и двух параллельных Sharp-конверсий на файл; оценить память/CPU в реальном CI и на рабочих машинах.
- [ ] Проверить закрытие watcher и судьбу уже запущенных conversion/initial-pass promises при `server.close()`.
- [ ] Проверить семантику и уровни логов: converted/skipped/failed, per-file и summary, `logger.info/warnOnce/error`.
- [ ] Отметить maintainability: связность функций, дублирование опций, ясность имён и сложность без предложения несвязанного рефакторинга.

**Deliverable:** список кандидатов в находки с кодовыми ссылками и практическими сценариями.

### Task 4: Проверить публичный API, типы и package metadata

**Files:**
- Review: `vite-webp-avif-generator-plugin.d.ts`
- Review: `package.json`
- Review: `package-lock.json` (локальная воспроизводимость, несмотря на `.gitignore`)
- Review: `PUBLISHING.md`

- [ ] Сопоставить каждую опцию runtime/JSDoc/`.d.ts` по имени, типу, default и смыслу.
- [ ] Проверить совместимость imported Sharp option types с заявленным peer/dependency range.
- [ ] Проверить `main`, `types`, `exports`, `files`, `type`, engine и peer ranges.
- [ ] Выполнить `npm pack --dry-run --json` и убедиться, что tarball содержит только заявленные пользовательские файлы.
- [ ] Проверить согласованность версии, changelog-заголовка, publishing checklist и фактического lockfile.
- [ ] Оценить наличие реально необходимого test script/CI gate как риска публикации, а не как стилевого пожелания.

**Deliverable:** аудит потребительского контракта и готовности пакета к публикации.

### Task 5: Проверить документацию и описания

**Files:**
- Review: `README.md`
- Review: `CHANGELOG.md`
- Review: `PUBLISHING.md`
- Cross-check: runtime, `.d.ts`, `package.json`

- [ ] Проверить install/import/config examples на копируемость и соответствие ESM/Vite.
- [ ] Проверить все defaults, поддерживаемые расширения, правила existing targets, generated files, initial pass, excludes и publicDir.
- [ ] Проверить, описаны ли важные ограничения: dev-only, add-vs-change, output collisions, отсутствие перезаписи существующих target-файлов.
- [ ] Проверить утверждения Nuxt и Vite на точность и отсутствие чрезмерно широких формулировок.
- [ ] Проверить changelog на SemVer/Keep a Changelog согласованность, версии и ссылки.
- [ ] Проверить орфографию, терминологию и одинаковые названия опций во всех документах.

**Deliverable:** перечень конкретных несоответствий docs ↔ runtime ↔ types ↔ package.

### Task 6: Выполнить динамические проверки обычных сценариев

**Files:**
- Run: `playground/scripts/run-tests.mjs`
- Run: `playground/scripts/test-format-options.mjs`
- Run: остальные `playground/scripts/test-*.mjs`

- [ ] Выполнить существующий основной playground suite и сохранить exit code/summary.
- [ ] Выполнить сценарии native Sharp options, logging, initial/live race, Nuxt publicDir/srcDir и watcher cleanup отдельно, если основной suite их не покрывает.
- [ ] Проверить syntax/import smoke: импорт default export и создание Vite plugin object.
- [ ] Проверить package smoke из dry-run tarball или через `npm pack`: exports/types/публикуемый allowlist.
- [ ] Для кандидатов P1/P2 написать минимальные одноразовые диагностические скрипты вне tracked-кода либо использовать `node --input-type=module`; не оставлять мусор в рабочем дереве.
- [ ] Повторно снять `git status --short`, чтобы отделить тестовые артефакты от исходного dirty state.

**Deliverable:** воспроизводимые подтверждения или опровержения каждой значимой гипотезы.

### Task 7: Отфильтровать и ранжировать находки

- [ ] Для каждого кандидата ответить: возникает ли он при документированной конфигурации; насколько часто; теряются ли данные/ломается ли dev server/возникает ли только шум; покрыт ли тестом.
- [ ] Исключить из основных findings маловероятные события без обычного пользовательского пути.
- [ ] Для подтверждённых findings назначить P1/P2/P3 и указать кратчайший practical reproduction.
- [ ] Отдельно перечислить сильные стороны архитектуры и уже хорошо закрытые риски.
- [ ] Отдельно перечислить пробелы тестов/процесса, не выдавая отсутствие теста само по себе за runtime-баг.

**Deliverable:** финальный набор evidence-backed findings, отсортированный по severity.

### Task 8: Подготовить и проверить итоговый отчёт

- [ ] Начать отчёт с findings; если дефектов нет, сказать это явно и перечислить остаточные риски.
- [ ] Для каждого finding дать `file:line`, влияние, практический сценарий, доказательство и рекомендуемое направление исправления.
- [ ] Добавить матрицу покрытия: runtime, Vite API, types, README, changelog, package, playground.
- [ ] Добавить перечень выполненных команд и фактические результаты.
- [ ] Добавить итоговую оценку качества кода, архитектурных решений, документации и тестовой зрелости с коротким обоснованием.
- [ ] Проверить все локальные line references и все внешние ссылки перед выдачей.
- [ ] Убедиться, что ни один существующий пользовательский файл не был изменён ревью.

**Deliverable:** самодостаточный русскоязычный отчёт, отделяющий подтверждённые дефекты от улучшений и остаточных рисков.
