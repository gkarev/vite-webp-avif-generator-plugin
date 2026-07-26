# Native Sharp Format Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional native Sharp `webpOptions` and `avifOptions` pass-through configuration without changing existing conversion, overwrite, watcher, or Vite behavior.

**Architecture:** Capture the two optional objects once in `convertImages`, carry them through the existing handler-options path used by live events and the initial pass, and pass the selected object directly to Sharp's optional format method. Sharp owns defaults and value validation; the plugin keeps its current target-exists guard and error handling.

**Tech Stack:** Node.js ESM, Vite plugin API, Sharp, Chokidar, plain Node integration scripts.

## Global Constraints

- Keep `convertImages(config = {})` and all existing defaults backward-compatible.
- Do not change `package.json`, Vite dependencies, peer ranges, hooks, or compatibility text.
- Keep `webpOptions` and `avifOptions` optional; do not create plugin-owned compression defaults.
- Pass native objects unchanged to `sharp(source).webp(options)` and `sharp(source).avif(options)`.
- Do not add custom presets, shorthand fields, deep validation, callbacks, caching, or regeneration.
- Existing `.webp` and `.avif` targets remain immutable until the user deletes them.
- Preserve atomic temp-file writes, `Promise.allSettled`, logging, path resolution, watcher cleanup, and initial-pass concurrency.
- Keep runtime code in `vite-webp-avif-generator-plugin.js`; do not introduce a build step or `src/` tree.

---

## File map

| File | Planned responsibility |
| --- | --- |
| `playground/scripts/test-format-options.mjs` | New isolated integration coverage for defaults, native options, live adds, skip-existing, and errors |
| `vite-webp-avif-generator-plugin.js` | Capture, forward, and apply the native format options |
| `vite-webp-avif-generator-plugin.d.ts` | Expose Sharp's native `WebpOptions` and `AvifOptions` types |
| `README.md` | Document the API, direct-Sharp migration, and regeneration rule |
| `CHANGELOG.md` | Record the additive feature under `Unreleased` |

No other file is part of the implementation diff.

---

### Task 1: Implement native options with focused integration coverage

**Files:**
- Create: `playground/scripts/test-format-options.mjs`
- Modify: `vite-webp-avif-generator-plugin.js:10-19`
- Modify: `vite-webp-avif-generator-plugin.js:29-40`
- Modify: `vite-webp-avif-generator-plugin.js:89-114`
- Modify: `vite-webp-avif-generator-plugin.js:141-199`
- Modify: `vite-webp-avif-generator-plugin.js:228-253`
- Modify: `vite-webp-avif-generator-plugin.d.ts:6-52`

**Interfaces:**
- Consumes: `convertImages(config?: PluginConfig): Plugin`, existing `createCaptureLogger()`, Vite `createServer()` in middleware mode.
- Produces: `PluginConfig.webpOptions?: import("sharp").WebpOptions`, `PluginConfig.avifOptions?: import("sharp").AvifOptions`, and internal `convertImage(..., { sharpOptions })` support.

- [ ] **Step 1: Create the focused integration test before changing runtime code**

Create `playground/scripts/test-format-options.mjs` with the complete content below:

```js
import { createServer } from "vite";
import sharp from "sharp";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { setTimeout as delay } from "timers/promises";
import convertImages from "../../vite-webp-avif-generator-plugin.js";
import { createCaptureLogger } from "./capture-logger.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const playgroundRoot = resolve(__dirname, "..");
const scratchRoot = resolve(playgroundRoot, ".format-options-scratch");

const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`  ${condition ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

async function waitFor(predicate, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true;
    await delay(intervalMs);
  }
  return false;
}

async function createDetailedPng(filePath) {
  const width = 320;
  const height = 240;
  const channels = 3;
  const pixels = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      pixels[offset] = (x * 13 + y * 7 + ((x * y) % 251)) % 256;
      pixels[offset + 1] = (x * 3 + y * 17 + ((x + y) % 239)) % 256;
      pixels[offset + 2] = (x * 19 + y * 5 + ((x * 11 + y * 23) % 233)) % 256;
    }
  }

  await mkdir(dirname(filePath), { recursive: true });
  await sharp(pixels, { raw: { width, height, channels } }).png().toFile(filePath);
}

async function encodeDirect(sourcePath, format, options) {
  const pipeline = sharp(sourcePath);
  return options === undefined
    ? pipeline[format]().toBuffer()
    : pipeline[format](options).toBuffer();
}

async function startServer(caseDir, pluginOptions, capture) {
  await mkdir(resolve(caseDir, "public/img"), { recursive: true });
  return createServer({
    root: caseDir,
    publicDir: resolve(caseDir, "public"),
    configFile: false,
    customLogger: capture.logger,
    server: { middlewareMode: true },
    plugins: [
      convertImages({
        folders: ["public/img"],
        enableInitialPass: true,
        ...pluginOptions
      })
    ]
  });
}

async function waitForInitialPass(capture) {
  const completed = await waitFor(() => capture.text().includes("Initial pass complete"));
  if (!completed) {
    throw new Error(`Initial pass timed out:\n${capture.text()}`);
  }
}

async function runInitialCase(name, pluginOptions, prepareTarget) {
  const caseDir = resolve(scratchRoot, name);
  const sourcePath = resolve(caseDir, "public/img/sample.png");
  const webpPath = resolve(caseDir, "public/img/sample.webp");
  const avifPath = resolve(caseDir, "public/img/sample.avif");

  await rm(caseDir, { recursive: true, force: true });
  await createDetailedPng(sourcePath);
  if (prepareTarget) await prepareTarget({ sourcePath, webpPath, avifPath });

  const capture = createCaptureLogger();
  const server = await startServer(caseDir, pluginOptions, capture);
  try {
    await waitForInitialPass(capture);
  } finally {
    await server.close();
  }

  return { caseDir, sourcePath, webpPath, avifPath, capture };
}

async function runLiveCase(name, pluginOptions) {
  const caseDir = resolve(scratchRoot, name);
  const sourcePath = resolve(caseDir, "public/img/live.png");
  const webpPath = resolve(caseDir, "public/img/live.webp");
  const avifPath = resolve(caseDir, "public/img/live.avif");

  await rm(caseDir, { recursive: true, force: true });
  const capture = createCaptureLogger();
  const server = await startServer(caseDir, pluginOptions, capture);

  try {
    await waitForInitialPass(capture);
    await createDetailedPng(sourcePath);
    const converted = await waitFor(() => existsSync(webpPath) && existsSync(avifPath));
    if (!converted) {
      throw new Error(`Live conversion timed out:\n${capture.text()}`);
    }
  } finally {
    await server.close();
  }

  return { sourcePath, webpPath, avifPath, capture };
}

async function testInitialPassNativeOptions() {
  console.log("\n## Native options reach the initial pass");
  const webpOptions = { quality: 37, effort: 1, smartSubsample: true };
  const avifOptions = { quality: 43, effort: 0, chromaSubsampling: "4:2:0" };
  const result = await runInitialCase("initial-native-options", {
    webpOptions,
    avifOptions
  });

  const actualWebp = await readFile(result.webpPath);
  const actualAvif = await readFile(result.avifPath);
  const expectedWebp = await encodeDirect(result.sourcePath, "webp", webpOptions);
  const expectedAvif = await encodeDirect(result.sourcePath, "avif", avifOptions);

  check("initial WebP equals direct Sharp output", actualWebp.equals(expectedWebp));
  check("initial AVIF equals direct Sharp output", actualAvif.equals(expectedAvif));
}

async function testLiveNativeOptions() {
  console.log("\n## Native options reach live additions");
  const webpOptions = { quality: 64, effort: 2, nearLossless: true };
  const avifOptions = { quality: 36, effort: 0, chromaSubsampling: "4:2:0" };
  const result = await runLiveCase("live-native-options", {
    webpOptions,
    avifOptions
  });

  const actualWebp = await readFile(result.webpPath);
  const actualAvif = await readFile(result.avifPath);
  const expectedWebp = await encodeDirect(result.sourcePath, "webp", webpOptions);
  const expectedAvif = await encodeDirect(result.sourcePath, "avif", avifOptions);

  check("live WebP equals direct Sharp output", actualWebp.equals(expectedWebp));
  check("live AVIF equals direct Sharp output", actualAvif.equals(expectedAvif));
}

async function testOmittedOptions() {
  console.log("\n## Omitted options keep Sharp defaults");
  const result = await runInitialCase("omitted-options", {});

  const actualWebp = await readFile(result.webpPath);
  const actualAvif = await readFile(result.avifPath);
  const expectedWebp = await encodeDirect(result.sourcePath, "webp", undefined);
  const expectedAvif = await encodeDirect(result.sourcePath, "avif", undefined);

  check("default WebP equals direct no-argument Sharp output", actualWebp.equals(expectedWebp));
  check("default AVIF equals direct no-argument Sharp output", actualAvif.equals(expectedAvif));
}

async function testExistingTargetIsUntouched() {
  console.log("\n## Existing targets remain untouched");
  const marker = Buffer.from("existing-target-must-not-change");
  let beforeMtimeMs;
  const result = await runInitialCase(
    "existing-target",
    { enableAvif: false, webpOptions: { quality: 1 } },
    async ({ webpPath }) => {
      await writeFile(webpPath, marker);
      beforeMtimeMs = (await stat(webpPath)).mtimeMs;
    }
  );

  const after = await readFile(result.webpPath);
  const afterMtimeMs = (await stat(result.webpPath)).mtimeMs;
  check("existing WebP bytes are unchanged", after.equals(marker));
  check("existing WebP mtime is unchanged", afterMtimeMs === beforeMtimeMs);
}

async function testInvalidNativeValue() {
  console.log("\n## One Sharp error does not block the other format");
  const avifOptions = { quality: 41, effort: 0 };
  const result = await runInitialCase("invalid-options", {
    webpOptions: { quality: 101 },
    avifOptions
  });

  const actualAvif = await readFile(result.avifPath);
  const expectedAvif = await encodeDirect(result.sourcePath, "avif", avifOptions);
  const entries = await readdir(dirname(result.webpPath));

  check("invalid WebP is not published", !existsSync(result.webpPath));
  check("valid AVIF still succeeds", existsSync(result.avifPath));
  check("successful AVIF equals direct Sharp output", actualAvif.equals(expectedAvif));
  check("Sharp validation error is logged", result.capture.text().includes("conversion failed"));
  check("initial summary counts the failure", /failed 1\b/.test(result.capture.text()));
  check("failed conversion leaves no temp file", !entries.some((entry) => entry.endsWith(".tmp")));
}

async function main() {
  console.log("Running native Sharp format option checks...");
  await rm(scratchRoot, { recursive: true, force: true });

  try {
    await testInitialPassNativeOptions();
    await testLiveNativeOptions();
    await testOmittedOptions();
    await testExistingTargetIsUntouched();
    await testInvalidNativeValue();
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }

  const passed = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);
  console.log(`\nResults: ${passed}/${results.length} passed`);

  if (failed.length > 0) {
    for (const result of failed) {
      console.log(`  FAIL ${result.name}${result.detail ? ` - ${result.detail}` : ""}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the focused test and verify the new expectations fail**

Run:

```powershell
node playground/scripts/test-format-options.mjs
```

Expected before implementation:

- process exits with code `1`;
- default/empty-options parity passes;
- direct-Sharp equality assertions fail because the plugin ignores both objects;
- the invalid-quality case creates a WebP instead of logging a Sharp error.

- [ ] **Step 3: Extend runtime JSDoc and capture the optional objects**

Add these properties to the `PluginConfig` JSDoc in `vite-webp-avif-generator-plugin.js`:

```js
 * @property {import("sharp").WebpOptions} [webpOptions] - Native options passed unchanged to `sharp().webp()`
 * @property {import("sharp").AvifOptions} [avifOptions] - Native options passed unchanged to `sharp().avif()`
```

Replace the factory destructuring block with:

```js
  const {
    folders = ["src/img", "public/img"],
    exclude = [],
    enableAvif = true,
    enableInitialPass = true,
    publicDir: publicDirOption,
    webpOptions,
    avifOptions
  } = config;

  const formatOptions = {
    webp: webpOptions,
    avif: avifOptions
  };
```

Do not replace `undefined` with `{}` and do not validate or clone these values.

- [ ] **Step 4: Forward the same format map through live and initial paths**

In the object passed to `handleFileAdd` inside `watcher.on("add", ...)`, add:

```js
          formatOptions,
```

The complete handler-options tail must read:

```js
          exclude: resolvedExclude,
          enableAvif,
          SUPPORTED_FORMATS,
          formatOptions,
          logger
```

In the object passed to `runInitialPass`, add the identical field:

```js
            exclude: resolvedExclude,
            enableAvif,
            SUPPORTED_FORMATS,
            formatOptions,
            logger
```

- [ ] **Step 5: Select and apply the native object at the existing conversion boundary**

Add this handler JSDoc property:

```js
 * @param {{webp: import("sharp").WebpOptions|undefined, avif: import("sharp").AvifOptions|undefined}} options.formatOptions - Native Sharp options by target format
```

Replace the `handleFileAdd` options destructuring with:

```js
  const {
    rootDir,
    publicDir,
    exclude,
    enableAvif,
    SUPPORTED_FORMATS,
    formatOptions,
    logger,
    isBulk = false
  } = options;
```

Replace the conversion mapping call with:

```js
      conversions.map(({ format, targetPath }) =>
        convertImage(filePath, targetPath, format, {
          quiet: isBulk,
          logger,
          sharpOptions: formatOptions[format]
        })
      )
```

Add this `convertImage` JSDoc property:

```js
 * @param {import("sharp").WebpOptions|import("sharp").AvifOptions} [options.sharpOptions] - Native options for the selected Sharp output method
```

Replace the function signature with:

```js
async function convertImage(
  sourcePath,
  targetPath,
  format,
  { quiet = false, logger = console, sharpOptions } = {}
) {
```

Replace only the Sharp output call inside the existing `try` block:

```js
    await sharp(sourcePath)[format](sharpOptions).toFile(tempPath);
```

Do not move the existing `existsSync(targetPath)` guard or alter the temp-file cleanup.

- [ ] **Step 6: Add the public TypeScript fields using Sharp's exported interfaces**

Add the following properties after `enableInitialPass` and before `publicDir` in `vite-webp-avif-generator-plugin.d.ts`:

```ts
  /**
   * Native options passed unchanged to Sharp's `.webp()` output method.
   * Omit this field to use Sharp's own WebP defaults.
   */
  webpOptions?: import('sharp').WebpOptions;

  /**
   * Native options passed unchanged to Sharp's `.avif()` output method.
   * Omit this field to use Sharp's own AVIF defaults.
   */
  avifOptions?: import('sharp').AvifOptions;
```

Do not reproduce individual Sharp fields in this declaration.

- [ ] **Step 7: Run syntax and focused tests**

Run:

```powershell
node --check vite-webp-avif-generator-plugin.js
rg -n "interface WebpOptions|interface AvifOptions" node_modules/sharp/lib/index.d.ts
node playground/scripts/test-format-options.mjs
```

Expected:

- syntax check exits with code `0` and prints nothing;
- installed Sharp declarations contain both referenced native interfaces;
- focused script exits with code `0`;
- final focused result is `Results: 14/14 passed`.

This is intentionally a static declaration smoke-check. Do not add `typescript` or any
other compiler dependency for this feature; the focused runtime test and Sharp's own
published interfaces cover the contract without expanding the package toolchain.

- [ ] **Step 8: Review the task diff and commit the independently testable feature**

Run:

```powershell
git diff -- vite-webp-avif-generator-plugin.js vite-webp-avif-generator-plugin.d.ts playground/scripts/test-format-options.mjs
git status --short
```

Expected: only the runtime, declaration file, and new focused test are present for this task; no `package.json` or Vite configuration changes.

Commit:

```powershell
git add vite-webp-avif-generator-plugin.js vite-webp-avif-generator-plugin.d.ts playground/scripts/test-format-options.mjs
git commit -m "feat: add native Sharp format options"
```

---

### Task 2: Document native migration and unchanged regeneration behavior

**Files:**
- Modify: `README.md:84-151`
- Modify: `CHANGELOG.md:1-8`

**Interfaces:**
- Consumes: `PluginConfig.webpOptions` and `PluginConfig.avifOptions` implemented in Task 1.
- Produces: consumer-facing configuration and migration guidance matching the runtime contract.

- [ ] **Step 1: Extend the README options table**

Add these rows to the `## Options` table without changing existing rows:

```markdown
| `webpOptions` | `import('sharp').WebpOptions` | _(unset)_ | Native options passed unchanged to Sharp's `.webp()` method |
| `avifOptions` | `import('sharp').AvifOptions` | _(unset)_ | Native options passed unchanged to Sharp's `.avif()` method |
```

- [ ] **Step 2: Add the native Sharp configuration and migration section**

Insert the following section immediately after the options table:

````markdown
### Native Sharp output options

`webpOptions` and `avifOptions` accept the same native option objects as Sharp's
[`webp()` and `avif()` output methods](https://sharp.pixelplumbing.com/api-output/).
The plugin passes these objects to Sharp unchanged and does not define its own compression
defaults.

```js
convertImages({
  webpOptions: {
    quality: 82,
    effort: 5,
    smartSubsample: true,
  },
  avifOptions: {
    quality: 48,
    effort: 4,
    chromaSubsampling: '4:2:0',
  },
})
```

This makes an existing direct Sharp setup easy to migrate:

```js
// Direct Sharp usage:
await sharp(input).webp(webpOptions).toFile(target)

// Equivalent plugin configuration:
convertImages({ webpOptions })
```

Both fields are optional. When omitted, Sharp uses its own defaults, preserving the
plugin's previous output behavior. The exact available properties follow the installed
supported Sharp version.

The migration covers Sharp's WebP/AVIF output-method options only. Arbitrary pipeline
operations such as `resize()`, `rotate()`, `flatten()`, or metadata transforms are not
part of these configuration objects.

Existing targets are still skipped. If you change an option and want to regenerate an
already-created `.webp` or `.avif`, delete that target file and let the initial pass or
watcher create it again. A standalone `.webp` source is not re-encoded as WebP, so only
`avifOptions` applies to its generated AVIF sibling.
````

- [ ] **Step 3: Add an Unreleased changelog entry**

Insert this block before `## [2.3.1]` in `CHANGELOG.md`:

```markdown
## [Unreleased]

### Added
- Optional native `webpOptions` and `avifOptions`, passed unchanged to Sharp's
  `.webp()` and `.avif()` methods. Omitting them preserves Sharp defaults and existing
  generated targets continue to be skipped.
```

- [ ] **Step 4: Verify docs, package contents, and focused behavior**

Run:

```powershell
rg -n "webpOptions|avifOptions|Existing targets" README.md CHANGELOG.md vite-webp-avif-generator-plugin.d.ts
node playground/scripts/test-format-options.mjs
npm pack --dry-run
```

Expected:

- both option names appear in types, README, and changelog;
- focused tests finish with `Results: 14/14 passed`;
- dry-run package output includes the runtime, declaration file, README, changelog, and license;
- no roadmap, playground, scratch, or temporary files appear in the published package list.

- [ ] **Step 5: Review and commit consumer documentation**

Run:

```powershell
git diff -- README.md CHANGELOG.md
git status --short
```

Expected: documentation describes direct native pass-through and manual deletion for regeneration; no dependency or Vite change is present.

Commit:

```powershell
git add README.md CHANGELOG.md
git commit -m "docs: document native Sharp format options"
```

---

### Task 3: Run the complete regression and release-readiness cycle

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: completed runtime, declarations, focused tests, README, and changelog.
- Produces: evidence that the additive feature does not alter established Vite, Nuxt, watcher, logging, race, packaging, or idempotency behavior.

- [ ] **Step 1: Run the focused feature suite from a clean scratch state**

Run:

```powershell
node playground/scripts/test-format-options.mjs
```

Expected: exit code `0`, `Results: 14/14 passed`, and `.format-options-scratch` removed in `finally`.

- [ ] **Step 2: Run the main end-to-end Vite suite**

Run:

```powershell
node playground/scripts/run-tests.mjs
```

Expected: exit code `0`, all reported checks pass, and there is no `Failed:` section.

- [ ] **Step 3: Run logging regression**

Run:

```powershell
node playground/scripts/test-logging.mjs
```

Expected: exit code `0`; labeled logger, `warnOnce`, and `logLevel` checks all pass.

- [ ] **Step 4: Run Nuxt path and watcher lifecycle regressions**

Run each command separately:

```powershell
node playground/scripts/test-nuxt-srcdir-public.mjs
node playground/scripts/test-nuxt-watcher-cleanup.mjs
```

Expected: both exit with code `0`; explicit `publicDir`, middleware-mode cleanup, and restart scenarios pass.

- [ ] **Step 5: Run the initial-pass race regression**

Run:

```powershell
node playground/scripts/test-race-initial-pass.mjs
```

Expected: exit code `0`; the file added during the initial pass receives complete WebP and AVIF derivatives.

- [ ] **Step 6: Verify syntax and publish allowlist**

Run:

```powershell
node --check vite-webp-avif-generator-plugin.js
npm pack --dry-run
```

Expected: syntax exits with code `0`; package contents remain limited by the existing `files` allowlist.

- [ ] **Step 7: Perform the final scope and cleanliness audit**

Run:

```powershell
git diff HEAD~2 --stat
git diff HEAD~2 -- package.json playground/vite.config.js
git status --short
```

Expected:

- the feature diff contains only the five scoped files;
- `package.json` and Vite configuration have no diff;
- the worktree is clean after the two planned commits;
- no scratch directory, temp image, or generated test configuration remains.

- [ ] **Step 8: Prepare release handoff without publishing**

Record in the handoff:

```text
Feature: optional native webpOptions/avifOptions pass-through
Compatibility: additive; omitted options preserve Sharp defaults
Regeneration: existing targets remain skipped; delete them manually to re-encode
Vite/dependencies: unchanged
Verification: focused suite + all existing integration suites + npm pack dry run
Release type: minor; actual version bump and npm publish are separate authorized tasks
```

Do not change the package version, create a tag, push, or publish as part of this plan.

---

## Plan acceptance checklist

- [ ] The public API exposes only native optional `WebpOptions` and `AvifOptions`.
- [ ] Omitted options keep Sharp defaults and previous plugin behavior.
- [ ] Initial-pass and live-add outputs for both formats are byte-equal to direct Sharp calls with the same objects.
- [ ] Existing targets are proven immutable.
- [ ] Invalid native values are proven to use the current non-fatal error path.
- [ ] Runtime, declarations, README, and changelog agree on the contract.
- [ ] No Vite, dependency, watcher, path, concurrency, naming, or logging change appears.
- [ ] All focused and existing tests pass.
- [ ] Package contents remain unchanged except for updated published file contents.
- [ ] Versioning and publishing remain outside implementation scope.
