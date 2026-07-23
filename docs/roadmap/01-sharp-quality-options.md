# Roadmap 01 — Native Sharp options for WebP and AVIF

- Status: approved for implementation planning
- Type: additive, backward-compatible feature
- Target release: next minor release
- Updated: 2026-07-21
- Related: `docs/roadmap/02-output-name-collisions.md` (independent)

## 1. Essence of the task

The plugin currently calls Sharp without output options:

```js
sharp(sourcePath).webp()
sharp(sourcePath).avif()
```

Users therefore cannot reuse the native Sharp compression settings they already have in
scripts or other image plugins. The feature must add two optional pass-through objects:

```js
convertImages({
  webpOptions: { quality: 82, effort: 5 },
  avifOptions: { quality: 48, effort: 4, chromaSubsampling: "4:2:0" }
});
```

The objects must reach Sharp unchanged:

```js
sharp(sourcePath).webp(webpOptions)
sharp(sourcePath).avif(avifOptions)
```

This lets a project migrate existing native Sharp configuration into this converter and
use it as both a format generator and a format-level optimizer.

## 2. Goals

- Expose the native Sharp `WebpOptions` and `AvifOptions` objects.
- Keep both options fully optional.
- Preserve Sharp's own defaults when an option is omitted.
- Preserve the current skip-existing-target behavior.
- Apply the options to both the initial pass and live `add` events.
- Reuse Sharp as the source of truth for option names, ranges, defaults, and validation.
- Keep the implementation local to the current conversion flow.

## 3. Non-goals

- No Vite dependency, peer range, hook, or compatibility changes.
- No top-level `quality`, `effort`, `lossless`, or plugin-defined presets.
- No custom validation schema or normalization of Sharp values.
- No resize, rotate, metadata, or arbitrary Sharp pipeline callbacks.
- No regeneration when options change.
- No overwrite flag, cache, config hash, or orphan cleanup.
- No changes to path resolution, watcher lifecycle, concurrency, naming, logging format,
  atomic writes, or supported input extensions.
- No implementation of the independent output-name collision roadmap.

## 4. Public API

Extend `PluginConfig` with:

```ts
interface PluginConfig {
  /** Native options passed unchanged to sharp().webp(). */
  webpOptions?: import("sharp").WebpOptions;

  /** Native options passed unchanged to sharp().avif(). */
  avifOptions?: import("sharp").AvifOptions;
}
```

Inline `import("sharp")` types avoid adding a runtime import to the declaration file and
work with Sharp's `export = sharp` type model. The type names exist across the package's
supported Sharp range (`^0.32 || ^0.33 || ^0.34 || ^0.35`).

No plugin-level default object is required. `undefined` is passed to Sharp's optional
`webp(options?)` or `avif(options?)` argument, which retains Sharp defaults and mirrors a
direct no-argument call.

## 5. Migration model

Existing direct Sharp configuration:

```js
const webpOptions = { quality: 82, effort: 5, smartSubsample: true };
const avifOptions = { quality: 48, effort: 4, chromaSubsampling: "4:2:0" };

await sharp(input).webp(webpOptions).toFile(webpTarget);
await sharp(input).avif(avifOptions).toFile(avifTarget);
```

Equivalent plugin configuration:

```js
convertImages({
  webpOptions,
  avifOptions
});
```

Field names and values are not renamed or translated. Options introduced by a supported
Sharp upgrade become usable through Sharp's own types without expanding the plugin API.

## 6. Runtime design

### 6.1 Configuration capture

Destructure `webpOptions` and `avifOptions` from `config` without assigning plugin
defaults, then create an internal format map:

```js
const formatOptions = {
  webp: webpOptions,
  avif: avifOptions
};
```

This map is internal only. It is not an additional public option.

### 6.2 Data flow

Pass `formatOptions` through both existing handler entry points:

```text
convertImages(config)
  ├─ watcher "add" ────────┐
  └─ runInitialPass ───────┤
                            ▼
                    handleFileAdd
                            ▼
                    convertImage
                            ▼
           sharp(source)[format](nativeOptions)
```

`runInitialPass` already forwards handler options, so no new subsystem or state holder is
needed.

### 6.3 Conversion boundary

Extend only the existing conversion options object:

```js
convertImage(sourcePath, targetPath, format, {
  quiet: isBulk,
  logger,
  sharpOptions: formatOptions[format]
});
```

The conversion call becomes:

```js
await sharp(sourcePath)[format](sharpOptions).toFile(tempPath);
```

The current `existsSync(targetPath)` guard stays before Sharp is constructed. Therefore
changing `webpOptions` or `avifOptions` does not regenerate an existing derivative. Users
must delete the target file when they intentionally want to re-encode it.

## 7. Error behavior

- Do not validate or rewrite native option contents in the plugin.
- Sharp remains responsible for rejecting invalid supported values such as an out-of-range
  `quality` or `effort`.
- The current `convertImage` `try/catch` removes the temporary file, logs the Sharp error,
  and rethrows it into `Promise.allSettled`.
- One failed format does not prevent the other format from completing.
- The dev server and watcher stay alive after a conversion error.
- TypeScript users receive Sharp's native compile-time types; JavaScript users receive
  Sharp's normal runtime behavior.

## 8. Files in scope

| File | Responsibility |
| --- | --- |
| `vite-webp-avif-generator-plugin.js` | Capture, forward, and apply native options |
| `vite-webp-avif-generator-plugin.d.ts` | Publish native Sharp types in `PluginConfig` |
| `playground/scripts/test-format-options.mjs` | Isolated integration coverage |
| `README.md` | API, migration example, defaults, and regeneration note |
| `CHANGELOG.md` | Additive feature entry under `Unreleased` |

`package.json`, Vite configuration, existing watcher tests, and dependencies are outside
the change set.

## 9. Test strategy

Add an in-process integration script following `test-logging.mjs` and
`capture-logger.mjs`. Each case uses its own scratch directory and closes its Vite server
in `finally`.

### 9.1 Focused feature tests

1. **Native options reach the initial pass**
   - Convert a deterministic PNG through the plugin with non-default WebP and AVIF objects.
   - Encode the same source directly with `sharp(source).webp(webpOptions)` and
     `sharp(source).avif(avifOptions)`.
   - Assert each plugin output is byte-for-byte equal to its direct Sharp counterpart.

2. **Native options reach live additions**
   - Start the watcher on an empty folder and wait for the initial-pass summary.
   - Add the same deterministic PNG with both option objects configured.
   - Assert both live outputs are byte-for-byte equal to direct Sharp output.

3. **Omitted options preserve defaults**
   - Convert without either option.
   - Assert both outputs equal direct `sharp(source).webp()` and `.avif()` calls without
     arguments.

4. **Existing targets remain untouched**
   - Pre-create a target file, run the initial pass with custom options, and compare its
     bytes before and after.

5. **Invalid native value uses existing error path without blocking the other format**
   - Pass an out-of-range WebP quality together with valid AVIF options.
   - Assert no WebP target is published, the AVIF is byte-equal to direct Sharp output,
     the per-format conversion error is recorded, the summary counts one failure, no temp
     file remains, and `server.close()` succeeds.

### 9.2 Regression tests

Run the existing suites unchanged:

```powershell
node playground/scripts/run-tests.mjs
node playground/scripts/test-logging.mjs
node playground/scripts/test-nuxt-srcdir-public.mjs
node playground/scripts/test-nuxt-watcher-cleanup.mjs
node playground/scripts/test-race-initial-pass.mjs
```

Also run:

```powershell
node --check vite-webp-avif-generator-plugin.js
node playground/scripts/test-format-options.mjs
npm pack --dry-run
git status --short
```

## 10. Documentation requirements

README must state:

- both objects are optional;
- objects are passed unchanged to Sharp;
- omitting them keeps Sharp defaults;
- available properties depend on the installed supported Sharp version;
- changing options does not overwrite existing files;
- delete a target derivative to apply new settings;
- a standalone WebP source uses only `avifOptions`, because WebP-to-WebP conversion is
  already skipped.

The changelog should describe the change as additive and backward-compatible. Version
bumping and publishing remain a separate release task.

## 11. Implementation sequence

1. Add the focused test script and confirm it fails because options are ignored.
2. Add the two public fields to runtime JSDoc and `PluginConfig`.
3. Thread native options through both handler entry points.
4. Pass the selected native object to Sharp at the existing conversion boundary.
5. Run the focused feature tests.
6. Update README and `CHANGELOG.md`.
7. Run syntax, focused, regression, packaging, and worktree checks.
8. Review the diff for accidental Vite, dependency, watcher, path, or naming changes.

## 12. Acceptance criteria

- [ ] `webpOptions` is typed as `import("sharp").WebpOptions`.
- [ ] `avifOptions` is typed as `import("sharp").AvifOptions`.
- [ ] Both fields are optional and have no plugin-owned compression defaults.
- [ ] Native objects reach Sharp unchanged in initial and live conversion flows.
- [ ] Existing targets are never regenerated because options changed.
- [ ] Invalid Sharp values use the existing conversion-error path.
- [ ] No Vite, dependency, watcher, path, concurrency, naming, or logging changes occur.
- [ ] Focused feature tests pass.
- [ ] Existing regression scripts pass unchanged.
- [ ] README and changelog match the runtime and type declarations.
- [ ] `npm pack --dry-run` contains the runtime, declarations, README, changelog, and
  license only as configured.

## 13. Main risks and controls

| Risk | Control |
| --- | --- |
| Options work only during the initial pass | Dedicated live-add test for both formats |
| Options work only for one format | Compare both WebP and AVIF with direct Sharp output |
| Plugin accidentally overrides Sharp defaults | Keep values `undefined`; compare with direct no-argument Sharp calls |
| Existing assets are unexpectedly replaced | Preserve and test the current existence guard |
| Plugin types drift from Sharp | Reference Sharp's exported option interfaces directly |
| Feature expands into a generic image pipeline | Keep resize/metadata/callback APIs explicitly out of scope |
| Tests leave watchers or files behind | Per-case `try/finally`, `server.close()`, scratch cleanup |

## 14. Definition of done

The feature is done when a user can move native WebP/AVIF output option objects from a
direct Sharp script into `convertImages`, obtain equivalent Sharp configuration for newly
generated derivatives, keep current behavior when the options are absent, and pass the
focused and existing integration suites without unrelated changes.
