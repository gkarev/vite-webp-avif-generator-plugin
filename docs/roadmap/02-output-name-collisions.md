# Roadmap 02 — Output naming & name-collision safety

- Status: proposed
- Type: feature + correctness (additive; default behavior preserved)
- Related: `docs/roadmap/01-sharp-quality-options.md` (independent; can ship in any order)
- Created: 2026-07-05

> This document is self-contained. It is written so that an engineer with no prior
> chat context can implement the task end-to-end. All file paths are relative to the
> repository root `vite-webp-avif-generator-plugin/`.

---

## 1. Project context (read first)

`vite-webp-avif-generator-plugin` is a single-file, dev-only Vite plugin
(`apply: "serve"`). It watches image folders and generates sibling `.webp`/`.avif`
files with `sharp`. See roadmap 01 §1 for the full project/testing overview (same repo).
Essentials repeated here:

- Runtime: `vite-webp-avif-generator-plugin.js` (ESM, no build step).
- Types: `vite-webp-avif-generator-plugin.d.ts`. Docs: `README.md`, `CHANGELOG.md`.
- Tests: plain Node scripts in `playground/scripts/` (`run-tests.mjs` spawns real Vite;
  `test-*.mjs` use in-process `createServer({ middlewareMode:true })` with the shared
  `capture-logger.mjs`). Run via `node playground/scripts/<file>.mjs`.
- `package.json` `files` publishes only `.js`, `.d.ts`, `README.md`, `CHANGELOG.md`,
  `LICENSE`. `docs/` is not published.

Relevant functions in `vite-webp-avif-generator-plugin.js`:

- `getTargetPath(sourcePath, format)` (~lines 411–416):
  ```js
  function getTargetPath(sourcePath, format) {
    const dir = dirname(sourcePath);
    const ext = extname(sourcePath);
    const name = basename(sourcePath, ext);   // drops the ORIGINAL extension
    return resolve(dir, `${name}.${format}`); // e.g. logo.png -> logo.webp
  }
  ```
- `isGeneratedFile(filePath)` (~lines 388–403): decides whether a `.webp`/`.avif` file is
  a plugin-generated derivative (to avoid re-processing loops). Current logic strips the
  derivative extension and checks for a same-basename `.jpg/.jpeg/.png` sibling:
  ```js
  const fileNameWithoutExt = basename(filePath, ext); // "logo" from "logo.webp"
  const possibleOriginals = [".jpg", ".jpeg", ".png"];
  return possibleOriginals.some((o) => existsSync(resolve(dir, fileNameWithoutExt + o)));
  ```
- `handleFileAdd(filePath, options)` calls `getTargetPath(...)` when building
  `conversions` (~lines 180–192) and `isGeneratedFile(filePath)` as a guard (~lines
  163–171). `options` is built in `configureServer` in two places (the `watcher.on("add")`
  callback and the `runInitialPass(...)` call) and forwarded to the initial pass via
  spread in `runInitialPass`.
- `runInitialPass(watchPaths, handlerOptions)` enumerates every file in the watched
  folders via `listFilesRecursively(dirPath, logger)` and calls `handleFileAdd` for each.
  This enumeration is reused for collision detection (see §5.1.4).
- Supported source extensions: `SUPPORTED_FORMATS = [".jpg",".jpeg",".png",".webp"]`
  (defined in the factory).

---

## 2. Problem / motivation

Because `getTargetPath` strips the source extension, two source images that share a
basename but differ in extension collide on the same output:

```
img/logo.png  -> img/logo.webp   (and logo.avif)
img/logo.jpg  -> img/logo.webp   (SAME TARGET)
```

Consequences:
- **Silent overwrite / race**: whichever converts last wins; during the concurrent
  initial pass both may pass the `existsSync` guard and race on the atomic rename.
- **Ambiguous loop detection**: `isGeneratedFile("logo.webp")` returns `true` if EITHER
  `logo.png` or `logo.jpg` exists, so a hand-authored `logo.webp` next to a raster
  `logo.png` is treated as generated and never gets its `.avif`.

This is a real correctness gap for projects that keep both PNG and JPG variants (or a
curated `.webp` beside a raster source).

Constraint: the current naming (`logo.png -> logo.webp`) is a **public contract** —
users reference `logo.webp` in HTML/CSS. Changing the default would break them. So the
fix must be **opt-in for new naming** and **non-breaking (log-only) for the default**.

---

## 3. Documentation evidence / design rationale

- Node `path`: `basename(p)` returns the full filename incl. extension; `basename(p, ext)`
  strips a trailing `ext`; `extname(p)` returns the last `.xxx`. These are the primitives
  used for both naming schemes. (Node `path` docs.)
- Prior art for collision-free naming: common asset pipelines emit derivatives as
  `name.originalext.newext` (e.g. `logo.png.webp`), which is inherently unique per source
  and trivially reversible for loop detection. This is the recommended `"preserve"` mode.
- The plugin already writes atomically (temp + `rename`), so the remaining risk is purely
  *logical* target collision, which naming/warnings address — no locking needed.

Decision: introduce an `outputNaming` option with two modes; keep `"replace"` (current)
as default for backward compatibility; add collision **warnings** in `"replace"` mode so
users are told to switch to `"preserve"` when an actual collision exists.

---

## 4. Proposed public API

```ts
convertImages({
  // ...existing options...
  outputNaming?: "replace" | "preserve", // default "replace"
})
```

- `"replace"` (default): `logo.png -> logo.webp` (today's behavior, unchanged).
- `"preserve"`: `logo.png -> logo.png.webp`, `logo.jpg -> logo.jpg.webp` — collision-free.

In `"replace"` mode, the plugin additionally detects and warns (once) when ≥2 distinct
source files would map to the same target.

---

## 5. Implementation steps

### 5.1 Runtime (`vite-webp-avif-generator-plugin.js`)

1. **Destructure + validate** the option in the factory (near lines 29–36):
   ```js
   const { /* ...existing... */ outputNaming = "replace" } = config;
   const resolvedNaming = outputNaming === "preserve" ? "preserve" : "replace";
   ```
   (Unknown values silently fall back to `"replace"`; optionally `logger.warnOnce`.)

2. **Thread `outputNaming`** into the handler options object in BOTH sites in
   `configureServer` (the `watcher.on("add")` callback and the `runInitialPass(...)` call),
   and destructure it in `handleFileAdd`. It then reaches the initial pass via the existing
   spread in `runInitialPass`.

3. **Make `getTargetPath` naming-aware**:
   ```js
   function getTargetPath(sourcePath, format, outputNaming = "replace") {
     const dir = dirname(sourcePath);
     if (outputNaming === "preserve") {
       // keep full filename incl. original extension: logo.png -> logo.png.webp
       return resolve(dir, `${basename(sourcePath)}.${format}`);
     }
     const ext = extname(sourcePath);
     const name = basename(sourcePath, ext);
     return resolve(dir, `${name}.${format}`);
   }
   ```
   Update the two calls in `handleFileAdd` to pass `outputNaming`.

4. **Make `isGeneratedFile` naming-aware**:
   ```js
   function isGeneratedFile(filePath, outputNaming = "replace") {
     const ext = extname(filePath).toLowerCase();
     if (![".avif", ".webp"].includes(ext)) return false;

     if (outputNaming === "preserve") {
       // strip only the derivative ext; the remainder still carries the original ext:
       //   logo.png.webp -> logo.png (exists ⇒ generated)
       //   hero.webp.avif -> hero.webp (exists ⇒ generated, avif-from-webp)
       const original = filePath.slice(0, -ext.length);
       return existsSync(original);
     }

     // replace mode: current logic (unchanged)
     const fileNameWithoutExt = basename(filePath, ext);
     const dirPath = dirname(filePath);
     const possibleOriginals = [".jpg", ".jpeg", ".png"];
     return possibleOriginals.some((o) =>
       existsSync(resolve(dirPath, fileNameWithoutExt + o))
     );
   }
   ```
   Update the call in `handleFileAdd` to pass `outputNaming`.

   Note on `"preserve"` + SUPPORTED_FORMATS: a generated `logo.png.webp` has ext `.webp`
   (a supported source), but `isGeneratedFile` now returns `true` for it, so it is skipped
   before any conversion — no loop. Verified logic:
   - `logo.png` (source) ⇒ `logo.png.webp`, `logo.png.avif`.
   - `logo.png.webp` re-observed ⇒ `slice` ⇒ `logo.png` exists ⇒ generated ⇒ skipped.
   - `logo.png.avif` re-observed ⇒ `slice` ⇒ `logo.png` exists ⇒ generated ⇒ skipped.
   - standalone `hero.webp` (no raster) ⇒ not generated ⇒ ⇒ `hero.webp.avif`;
     `hero.webp.avif` ⇒ `slice` ⇒ `hero.webp` exists ⇒ generated ⇒ skipped.

5. **Collision warning for `"replace"` mode** (best-effort, initial-pass scope). Add a
   helper and call it from `runInitialPass` after the file list is built, only when
   `handlerOptions.outputNaming !== "preserve"`:
   ```js
   function warnAboutTargetCollisions(files, supportedFormats, logger) {
     const bySource = new Map(); // targetWebpPath -> Set<sourcePath>
     for (const file of files) {
       const ext = extname(file).toLowerCase();
       if (ext === ".webp" || !supportedFormats.includes(ext)) continue;
       if (isGeneratedFile(file, "replace")) continue;
       const target = getTargetPath(file, "webp", "replace");
       const key = normalizeComparisonPath(target);
       if (!bySource.has(key)) bySource.set(key, new Set());
       bySource.get(key).add(file);
     }
     for (const [, sources] of bySource) {
       if (sources.size > 1) {
         logger.warnOnce(
           `${LOG_LABEL} Warning: multiple sources map to the same output ` +
             `(${[...sources].join(", ")}). Set outputNaming: "preserve" to avoid ` +
             `overwrites.`
         );
       }
     }
   }
   ```
   `runInitialPass` already has `logger` and `SUPPORTED_FORMATS` via `handlerOptions`; pass
   them in. Keep this initial-pass-only (live-add collisions are rarer and are covered by
   the general docs recommendation). `LOG_LABEL` is the existing module constant
   `"[vite-webp-avif-generator]"`.

No changes to watcher wiring, atomic write, or logging transport.

### 5.2 Types (`vite-webp-avif-generator-plugin.d.ts`)

Add to `interface PluginConfig`:
```ts
/**
 * Output filename scheme.
 * - "replace": logo.png -> logo.webp (default; original extension dropped).
 * - "preserve": logo.png -> logo.png.webp (collision-free across source extensions).
 * @default "replace"
 */
outputNaming?: "replace" | "preserve";
```

### 5.3 README (`README.md`)

- Add an `outputNaming` row to the Options table.
- Add a "Output naming" subsection under `## Path Resolution` or `## Supported Formats`
  explaining both modes, the collision problem, and the recommendation to use
  `"preserve"` when keeping same-named sources with different extensions. Note it changes
  output filenames, so update HTML/CSS references when switching.

### 5.4 Changelog (`CHANGELOG.md`)

Under `## [Unreleased]`:
- `### Added`: `outputNaming: "replace" | "preserve"` (default `"replace"`), plus a
  one-time warning in `"replace"` mode when multiple sources collide on one output.
- `### Fixed` (or note): documents that same-basename sources with different extensions
  no longer silently overwrite when `"preserve"` is used, and clarifies the
  `isGeneratedFile` ambiguity in `"replace"` mode.

### 5.5 Tests

Add `playground/scripts/test-output-naming.mjs` (in-process; follow `test-logging.mjs` +
`createCaptureLogger`). Assertions:

1. **Default = replace, unchanged**: `logo.png` ⇒ `logo.webp` + `logo.avif` created
   (parity with today).
2. **Replace-mode collision warning**: put `logo.png` and `logo.jpg` in the same folder,
   default naming ⇒ the captured logs contain exactly one labeled
   `Warning: multiple sources map to the same output` (verify via `capture.count(...) === 1`,
   i.e. `warnOnce` dedupe).
3. **Preserve mode, collision-free**: same two files with `outputNaming: "preserve"` ⇒
   `logo.png.webp`, `logo.jpg.webp`, `logo.png.avif`, `logo.jpg.avif` all exist; no
   collision warning.
4. **Preserve loop-avoidance / idempotency**: run the initial pass twice with
   `"preserve"`; the second run reports `converted 0` and does NOT create
   `logo.png.webp.webp` or re-process `logo.png.avif`.
5. **Preserve standalone webp**: a standalone `hero.webp` (no raster sibling) ⇒
   `hero.webp.avif` created; re-run does not reconvert it.

Also add a spawned-server sanity check (optional) mirroring `run-tests.mjs` section style
if you want end-to-end coverage; not required if the in-process cases pass.

Regression guard: `run-tests.mjs` uses `outputNaming` default (replace) implicitly — it
must stay green unchanged, proving backward compatibility.

---

## 6. Edge cases & decisions

- **Backward compatibility**: default `"replace"` + unchanged replace-mode
  `getTargetPath`/`isGeneratedFile` ⇒ identical behavior and identical output filenames
  for existing users. Only the (log-only) collision warning is new in replace mode.
- **`normalizeComparisonPath`** (existing helper) is used for the collision map key so
  Windows case-insensitivity matches the rest of the plugin.
- **Mixed generated files on disk when switching modes**: switching an existing project
  from `"replace"` to `"preserve"` leaves old `logo.webp` files around (now considered
  non-generated). This is expected; document that switching modes may leave stale
  derivatives (cleanup is a separate future feature — orphan removal).
- **Live-add collisions**: not warned per-event (would require scanning siblings on every
  add). Covered by initial-pass warning + docs. Acceptable for a dev tool.
- **Interaction with roadmap 01**: fully independent. If both are implemented, thread both
  `formatOptions` and `outputNaming` through the same handler options object.

---

## 7. Acceptance criteria

- [ ] `outputNaming?: "replace" | "preserve"` in `PluginConfig` (`.d.ts`) with JSDoc.
- [ ] `getTargetPath` and `isGeneratedFile` are naming-aware and threaded through
      `handleFileAdd` for both live adds and the initial pass.
- [ ] Default `"replace"` output filenames and loop-detection are unchanged
      (existing `run-tests.mjs` passes without edits).
- [ ] `"replace"` mode logs exactly one labeled collision warning per colliding target
      group during the initial pass (via `warnOnce`).
- [ ] `"preserve"` mode produces `name.ext.format` outputs, is idempotent on re-run, and
      never loops (no `*.webp.webp`, no reconversion of derivatives).
- [ ] `test-output-naming.mjs` passes all §5.5 assertions.
- [ ] README options table + "Output naming" section and CHANGELOG `[Unreleased]` updated.

---

## 8. Out of scope

- Removing orphaned derivatives when a source is deleted (separate feature).
- Regenerating on source `change` (separate feature).
- Custom user-supplied filename templates beyond the two modes.
- sharp quality options — see roadmap 01.
