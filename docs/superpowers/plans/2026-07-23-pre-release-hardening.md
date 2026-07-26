# Pre-release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** устранить подтверждённые pre-release дефекты безопасности, output naming, Vite server lifecycle, логирования и release verification без изменения default output paths.

**Architecture:** сохранить single-file runtime и добавить две локальные границы: naming-aware pure helpers и per-server task tracker. Все изменения вводятся через focused integration tests, затем синхронизируются с types/docs/package metadata.

**Tech Stack:** Node.js ESM, Vite 4–8 Plugin API, chokidar, Sharp 0.35+, plain Node integration scripts.

## Global Constraints

- Сохранить `apply: "serve"`, ESM и отсутствие build step.
- Сохранить default `outputNaming: "replace"` и существующие `name.webp`/`name.avif` paths.
- Не менять Node minimum `>=20.19.0` и Vite peer range.
- Не перезаписывать пользовательские release-правки версии `2.4.0`.
- Не выполнять commit, tag, push или publish.

---

### Task 1: Зафиксировать RED для output naming и source deduplication

**Files:**
- Create: `playground/scripts/test-output-naming.mjs`
- Test: `playground/scripts/test-output-naming.mjs`

**Interfaces:**
- Consumes: default plugin factory `convertImages(config)`.
- Produces: acceptance checks для `outputNaming`, collision warning и duplicate folders.

- [ ] **Step 1: Добавить replace-mode regression case**

Создать два визуально различных source `logo.png`/`logo.jpg`, запустить initial pass и проверить default targets плюс ровно один warning с `multiple sources map to the same output`.

- [ ] **Step 2: Добавить preserve-mode desired behavior**

Проверить наличие `logo.png.webp`, `logo.jpg.webp`, `logo.png.avif`, `logo.jpg.avif`, отсутствие `logo.webp` и отсутствие warning.

- [ ] **Step 3: Добавить duplicate-folder case**

Для `folders: ["img", "img"]` ожидать summary `processed 1, converted 2`.

- [ ] **Step 4: Запустить RED**

Run: `node playground/scripts/test-output-naming.mjs`
Expected: FAIL — option не реализована, warning отсутствует, duplicate source считается дважды.

### Task 2: Реализовать naming-aware paths и дедупликацию

**Files:**
- Modify: `vite-webp-avif-generator-plugin.js`
- Modify: `vite-webp-avif-generator-plugin.d.ts`

**Interfaces:**
- Produces: `outputNaming?: "replace" | "preserve"`, `getTargetPath(source, format, outputNaming)`, `isGeneratedFile(file, outputNaming)`, `warnAboutTargetCollisions(...)`.

- [ ] **Step 1: Добавить runtime option и threading**

Destructure `outputNaming = "replace"`, нормализовать неизвестное значение к `"replace"`, передать через handler options.

- [ ] **Step 2: Сделать target/generated helpers naming-aware**

```js
function getTargetPath(sourcePath, format, outputNaming = "replace") {
  if (outputNaming === "preserve") {
    return resolve(dirname(sourcePath), `${basename(sourcePath)}.${format}`);
  }
  return resolve(dirname(sourcePath), `${basename(sourcePath, extname(sourcePath))}.${format}`);
}
```

В `preserve` generated file определяется существованием path после удаления только derivative extension.

- [ ] **Step 3: Дедуплицировать initial paths**

После `filesByFolder.flat()` построить Map по `normalizeComparisonPath(filePath)` и использовать unique values для summary/workers.

- [ ] **Step 4: Добавить preflight collision warning в replace mode**

Сгруппировать фактические WebP/AVIF targets для supported, non-excluded, non-generated sources; при `sources.size > 1` вызвать `logger.warnOnce` с рекомендацией `outputNaming: "preserve"`.

- [ ] **Step 5: Добавить `.d.ts` field**

```ts
/**
 * Output filename strategy: replace drops the source extension; preserve keeps it.
 * @default "replace"
 */
outputNaming?: "replace" | "preserve";
```

- [ ] **Step 6: Запустить GREEN**

Run: `node playground/scripts/test-output-naming.mjs`
Expected: все checks PASS.

### Task 3: Зафиксировать и исправить active-work lifecycle

**Files:**
- Create: `playground/scripts/test-active-work-cleanup.mjs`
- Modify: `vite-webp-avif-generator-plugin.js`

**Interfaces:**
- Produces: per-server `processFileOnce`, `trackTask`, idempotent `cleanupPromise`.

- [ ] **Step 1: Добавить lifecycle RED test**

Создать detailed PNG, использовать slow AVIF `effort: 9`, дождаться `New file detected`, вызвать `await server.close()` и сразу проверить WebP, AVIF и `Initial pass complete`.

- [ ] **Step 2: Запустить RED**

Run: `node playground/scripts/test-active-work-cleanup.mjs`
Expected: FAIL — close возвращается до обоих targets/summary.

- [ ] **Step 3: Добавить per-server task tracking**

`activeTasks: Set<Promise>`, `activeFileTasks: Map<normalizedPath, Promise>`; live и initial routes используют один `processFileOnce`.

- [ ] **Step 4: Сделать close idempotent и ожидающим**

Один `cleanupPromise` выполняет `watcher.close()`, затем `Promise.allSettled([...activeTasks])`, логирует stop; каждый вызов после этого вызывает idempotent original Vite close.

- [ ] **Step 5: Запустить GREEN и watcher regression**

Run: `node playground/scripts/test-active-work-cleanup.mjs`
Run: `node playground/scripts/test-nuxt-watcher-cleanup.mjs`
Expected: оба exit `0`.

### Task 4: Исправить converted/skipped logging через TDD

**Files:**
- Modify: `playground/scripts/test-logging.mjs`
- Modify: `vite-webp-avif-generator-plugin.js`

- [ ] **Step 1: Добавить RED assertion**

Повторно запустить initial pass с existing targets и проверить отсутствие `Successfully converted` при summary `converted 0`.

- [ ] **Step 2: Запустить RED**

Run: `node playground/scripts/test-logging.mjs`
Expected: новый check FAIL.

- [ ] **Step 3: Считать только `result.value === "converted"`**

Удалить fulfilled-count как success source и печатать success line только при `tally.converted > 0`.

- [ ] **Step 4: Запустить GREEN**

Run: `node playground/scripts/test-logging.mjs`
Expected: все checks PASS.

### Task 5: Исправить race invariant и Windows cleanup

**Files:**
- Modify: `playground/scripts/test-race-initial-pass.mjs`
- Modify: `playground/scripts/test-format-options.mjs`

- [ ] **Step 1: Заменить race order assertion**

Удалить `raceIdx < summaryIdx`; оставить проверки: file dropped during pass, watcher detected, WebP exists, AVIF exists.

- [ ] **Step 2: Проверить race GREEN дважды**

Run twice: `node playground/scripts/test-race-initial-pass.mjs`
Expected: `4/4`, exit `0` в обоих прогонах.

- [ ] **Step 3: Убрать cached path из format comparison**

Для WebP-source expected AVIF вызвать direct Sharp encoding от уже прочитанного Buffer, не от `sourcePath`.

- [ ] **Step 4: Сделать cleanup strict**

В `finally` выполнить `await rm(scratchRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })` без подавления ошибки.

- [ ] **Step 5: Проверить format GREEN и postcondition**

Run: `node playground/scripts/test-format-options.mjs`
Then: `Test-Path playground/.format-options-scratch`
Expected: `17/17`, затем `False`.

### Task 6: Закрыть Sharp advisory и release gate

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (ignored local lock, не force-add)
- Modify: `.gitignore`
- Modify: `PUBLISHING.md`

- [ ] **Step 1: Зафиксировать RED**

Run: `npm audit --omit=dev` → Expected: FAIL для Sharp `<0.35.0`.
Run: `npm run verify` → Expected: FAIL, missing script.

- [ ] **Step 2: Ограничить Sharp**

Изменить dependency на `"sharp": "^0.35.0"`, затем выполнить `npm install` для синхронизации ignored lockfile и node_modules.

- [ ] **Step 3: Добавить scripts**

`verify` последовательно запускает syntax, все `playground/scripts/test-*.mjs`, основной suite, audit и pack dry-run с `--ignore-scripts`; `prepublishOnly` вызывает `npm run verify`.

- [ ] **Step 4: Разрешить tracking docs**

Добавить `.gitignore` exceptions `!PUBLISHING.md` и `!docs/**/*.md`; npm `files` allowlist не менять.

- [ ] **Step 5: Обновить publishing checklist**

Основная команда — `npm run verify`; перечислить составляющие и ожидаемые counts без дублирования ручного процесса.

- [ ] **Step 6: Запустить security/package GREEN**

Run: `npm ls sharp` → `sharp@0.35.x`.
Run: `npm audit --omit=dev` → exit `0`.
Run: `npm pack --dry-run --ignore-scripts` → только 6 published files.

### Task 7: Синхронизировать README и changelog

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Документировать outputNaming**

Добавить options row, replace/preserve examples, collision warning и migration note.

- [ ] **Step 2: Документировать lifecycle**

Уточнить, что close ждёт зарегистрированные active conversions перед завершением.

- [ ] **Step 3: Обновить compatibility/security**

Заменить Sharp 0.32–0.35 на 0.35+ и объяснить security floor.

- [ ] **Step 4: Дополнить release 2.4.0 changelog**

Добавить output naming, lifecycle/dedup/log/test fixes, Sharp security floor и verify gate, сохранив native-options entry пользователя.

### Task 8: Полная верификация

**Files:**
- Verify: все изменённые runtime/types/docs/tests/package files.

- [ ] **Step 1: Запустить полный gate**

Run: `npm run verify`
Expected: exit `0`, все scripts PASS, audit clean, tarball allowlist correct.

- [ ] **Step 2: Проверить metadata**

Run: `npm pkg get version dependencies.sharp scripts.verify scripts.prepublishOnly`
Expected: version `2.4.0`, Sharp `^0.35.0`, оба scripts определены.

- [ ] **Step 3: Проверить diff**

Run: `git diff --check` → no output.
Run: `git status --short` → только исходные пользовательские и одобренные task changes.

- [ ] **Step 4: Проверить план против spec**

Убедиться, что P-01–P-09 сопоставлены с FR/test/file и ни один acceptance criterion не остался без evidence.
