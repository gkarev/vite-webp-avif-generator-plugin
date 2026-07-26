# Pre-release hardening: системно-аналитическая спецификация

## 1. Цель и границы

Цель — до релиза `2.4.0` устранить подтверждённые ревью дефекты без изменения обычных output-имён и без несвязанного рефакторинга.

В scope входят:

- запрет уязвимых Sharp `<0.35.0`;
- безопасная стратегия для коллизий имён и дедупликация одинаковых source paths;
- ожидание активных задач при `ViteDevServer.close()`/restart;
- корректная статистика converted/skipped;
- исправление race-test и Windows cleanup;
- единый release verification gate;
- синхронизация runtime, типов и документации.

Вне scope: обработка `change`, удаление orphan derivatives, произвольные filename templates, отмена уже начатой операции Sharp, production-build conversion.

## 2. AS-IS и подтверждающие факты

| ID | AS-IS | Подтверждение |
| --- | --- | --- |
| P-01 | Разрешён и установлен Sharp `<0.35.0` | `npm audit --omit=dev` → 1 high vulnerability; установлен `0.34.5` |
| P-02 | `logo.png` и `logo.jpg` пишут общие targets | 5/5 прогонов: `converted 4`, физически 2 target, последний source перезаписывает первый |
| P-03 | Пересекающиеся folders повторно обрабатывают source | `folders: ['img', 'img']` → `processed 2, converted 4` |
| P-04 | `server.close()` не ждёт initial/live work | close `3ms`, WebP создан после close, AVIF продолжил удерживать процесс |
| P-05 | fulfilled `"skipped"` логируется как converted | summary `converted 0`, per-file `Successfully converted: 2` |
| P-06 | Race-test требует недокументированный порядок логов | два запуска `4/5`, targets созданы, падает только `raceIdx < summaryIdx` |
| P-07 | Format-options test скрывает cleanup failure | два запуска `17/17`, остаётся `sample.webp` |
| P-08 | Release checks не автоматизированы | `prepublishOnly` только печатает сообщение, `npm run verify` отсутствует |
| P-09 | Release checklist/docs игнорируются | `git check-ignore` указывает `.gitignore:35` |

## 3. TO-BE и функциональные требования

### FR-01. Безопасная версия Sharp

- `package.json` разрешает только `sharp: "^0.35.0"`.
- Локальный lockfile разрешает `sharp >=0.35.0`.
- `npm audit --omit=dev` не сообщает vulnerability для production dependencies.
- README не заявляет совместимость с Sharp 0.32–0.34.

### FR-02. Output naming

Добавить публичную опцию:

```ts
outputNaming?: "replace" | "preserve";
```

- Default `"replace"` сохраняет контракт: `logo.png -> logo.webp`.
- `"preserve"`: `logo.png -> logo.png.webp`, `logo.jpg -> logo.jpg.webp`, `hero.webp -> hero.webp.avif`.
- Generated derivatives не запускают новые циклы в обоих режимах.
- В `"replace"` initial pass до конверсий выдаёт одно `warnOnce` на каждый фактический target collision и предлагает `outputNaming: "preserve"`.
- README явно описывает риск `replace` и безопасный opt-in.

### FR-03. Дедупликация и in-flight coordination

- Initial pass нормализует абсолютные paths и обрабатывает каждый physical source path один раз, даже при duplicate/overlapping folders.
- Один server instance не запускает параллельно две обработки одного source path из live watcher и initial pass.
- Дедупликация не объединяет разные source paths; их конфликт регулируется FR-02.

### FR-04. Lifecycle active work

- Каждый `configureServer(server)` имеет собственные `activeTasks` и `activeFileTasks`.
- `server.close()` сначала закрывает watcher, затем ждёт все уже зарегистрированные tasks, затем вызывает original Vite close.
- Повторный/параллельный close использует один cleanup promise и логирует остановку watcher один раз.
- Ошибка одной конверсии остаётся внутри существующего tally/error path и не блокирует закрытие.

### FR-05. Достоверное логирование

- `Successfully converted: N` использует только число результатов `"converted"`.
- `"skipped"` не увеличивает success count.
- Итоговый initial-pass tally остаётся источником истины.

### FR-06. Детерминированные тесты и release gate

- Race-test проверяет факт live detection и оба target, не порядок `add` относительно summary.
- Format-options test использует Buffer для direct Sharp comparison там, где path остаётся cached на Windows, а финальный cleanup не скрывает ошибку.
- `npm run verify` последовательно запускает syntax, focused/regression scripts, `npm audit --omit=dev` и `npm pack --dry-run --ignore-scripts`.
- `prepublishOnly` вызывает `npm run verify`.
- `PUBLISHING.md` описывает один основной verify command и остаётся исключён из npm tarball.
- `PUBLISHING.md` и `docs/**/*.md` могут отслеживаться Git.

## 4. Нефункциональные требования

- Backward compatibility: default output filenames неизменны.
- Vite 4–8 hooks/API не меняются; plugin остаётся `apply: "serve"`.
- Node minimum остаётся `20.19.0`.
- Все сообщения идут через Vite logger и `LOG_LABEL`.
- Atomic temp-write + rename сохраняется.
- Новая логика остаётся в существующем single runtime file; build step не добавляется.
- Concurrency initial pass остаётся bounded; scope не включает изменение его численного лимита без отдельного performance evidence.

## 5. Data flow TO-BE

```text
configureServer
  ├─ watcher.add ─┐
  └─ watcher.ready ─ runInitialPass ─ deduplicate paths ─ collision warning
                    │
                    └────────────── processFileOnce(filePath, isBulk)
                                           │
                                           ├─ activeFileTasks[path]
                                           ├─ activeTasks
                                           └─ handleFileAdd
                                                  └─ getTargetPath(outputNaming)

server.close
  └─ watcher.close → await activeTasks → originalClose
```

## 6. Error model

- Invalid Sharp options: текущая format-level ошибка, sibling format продолжает работу.
- Collision в `replace`: warning, существующее naming-поведение сохраняется для совместимости.
- Failed watcher close: error log, но original close всё равно вызывается.
- Failed active task: `Promise.allSettled`, shutdown продолжается.
- Cleanup test fixture: ошибка больше не подавляется; test exit code становится ненулевым.

## 7. Трассировка требований

| Проблема | Требование | Тест | Изменяемые файлы |
| --- | --- | --- | --- |
| P-01 | FR-01 | `npm audit --omit=dev`, `npm ls sharp` | `package.json`, `package-lock.json`, README, changelog |
| P-02 | FR-02 | `test-output-naming.mjs` | runtime, `.d.ts`, README, changelog |
| P-03 | FR-03 | duplicate-folder case в `test-output-naming.mjs` | runtime |
| P-04 | FR-03/04 | `test-active-work-cleanup.mjs` | runtime |
| P-05 | FR-05 | logging idempotency case | runtime, `test-logging.mjs` |
| P-06 | FR-06 | исправленный `test-race-initial-pass.mjs` | race test |
| P-07 | FR-06 | format test + post-run absence check | format test |
| P-08/P-09 | FR-06 | `npm run verify`, `git check-ignore`, pack dry-run | package, `.gitignore`, PUBLISHING |

## 8. Acceptance criteria

- Все FR-01–FR-06 реализованы и имеют автоматическую проверку.
- Focused tests сначала воспроизводят прежний дефект, затем проходят после минимального исправления.
- `npm run verify` завершается exit code `0`.
- `npm audit --omit=dev` завершается без production vulnerabilities.
- `npm pack --dry-run --ignore-scripts` содержит только package metadata, runtime, types, README, changelog, license.
- `git diff --check` не находит whitespace errors.
- Существующие пользовательские изменения версии `2.4.0` и native format options сохранены.

