# Visible Incomplete Staging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep atomic target publication while replacing opaque crash leftovers with visible plugin-owned `.incomplete` files and removing only stale owned files after 24 hours.

**Architecture:** Continue writing beside the target and publishing with the existing same-filesystem `rename`. Add three private runtime helpers for staging-path creation, ownership recognition, and startup cleanup; reuse the existing recursive scanner, exclusion logic, concurrency runner, Vite logger, and watcher lifecycle.

**Tech Stack:** Node.js 20.19+ ESM, Vite 4-8 plugin hooks, Chokidar, Sharp, `fs/promises`, standalone Node integration scripts.

**Specification:** `docs/superpowers/specs/2026-07-25-visible-incomplete-staging-design.md` at design commit `b7748e9`.

## Global Constraints

- Preserve the default export and the complete public `PluginConfig` API.
- Do not modify `vite-webp-avif-generator-plugin.d.ts`.
- Do not add dependencies, build tooling, public options, or package-lock changes.
- Do not add `cacheDir`, OS-temp staging, lock files, PID leases, heartbeat files, hard links, or filesystem dependency injection.
- Keep target-local staging and the existing atomic `rename` publication boundary.
- Use exactly 8 random bytes encoded as 16 lowercase hexadecimal characters.
- Use the filename shape `<target>.vite-webp-avif-generator.<16-hex>.incomplete`.
- Use an internal TTL of exactly `24 * 60 * 60 * 1000` milliseconds.
- Do not add the staging pattern to `.gitignore`.
- Cleanup only exact plugin-owned regular files under watched, non-excluded folders.
- Reuse existing path normalization, recursive listing, concurrency, logger, and shutdown behavior.
- Treat the existing invalid-Sharp-options test as the representative caught failure path.
- Keep `outputNaming`, target collision behavior, source event coverage, and initial-pass concurrency unchanged.
- Make no unrelated formatting, naming, logging, or refactoring changes.

---

## File Map

| File | Responsibility | Planned change |
| --- | --- | --- |
| `vite-webp-avif-generator-plugin.js` | Complete runtime implementation | Add three private helpers, constants, ready-time stale cleanup, and diagnostic staging name |
| `playground/scripts/test-incomplete-cleanup.mjs` | Focused stale-cleanup contract | New isolated integration test using an OS temp project |
| `playground/scripts/run-tests.mjs` | End-to-end interrupt regression | Replace the fixed 400 ms and size-only assertion with staging observation and Sharp decode |
| `playground/scripts/test-format-options.mjs` | Representative caught failure | Assert that ordinary failure removes both legacy and new staging forms |
| `package.json` | Release verification gate | Add the focused cleanup script to `verify`; no dependency changes |
| `README.md` | User-visible behavior | Document `.incomplete`, intentional Git visibility, and 24-hour cleanup |
| `CHANGELOG.md` | Release history | Record the corrected crash contract and regression |
| `docs/reviews/2026-07-26-visible-incomplete-staging-regression.md` | Final evidence | Add the requested tabular regression report after verification |

Files explicitly not modified: `.gitignore`, `package-lock.json`, `vite-webp-avif-generator-plugin.d.ts`, `PUBLISHING.md`, Nuxt fixtures, output-naming tests, and watcher-cleanup tests.

---

### Task 1: Exact Ownership And TTL Cleanup

**Files:**
- Create: `playground/scripts/test-incomplete-cleanup.mjs`
- Modify: `vite-webp-avif-generator-plugin.js:1-12`
- Modify: `vite-webp-avif-generator-plugin.js:130-151`
- Modify: `vite-webp-avif-generator-plugin.js:580-680`
- Modify: `package.json:31`

**Interfaces:**
- Consumes: `listFilesRecursively(dirPath, logger)`, `isInExcludedFolder(filePath, exclude)`, `normalizeComparisonPath(path)`, and `runWithConcurrencyLimit(items, limit, worker)`.
- Produces: `isPluginOwnedIncompletePath(filePath): boolean` and `cleanupStaleIncompleteFiles(watchPaths, exclude, logger): Promise<void>`.
- Preserves: `configureServer(server)` return shape and all public plugin options.

- [ ] **Step 1: Create the focused failing cleanup test**

Create `playground/scripts/test-incomplete-cleanup.mjs` with the complete isolated test:

```js
import { existsSync } from "fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { setTimeout as delay } from "timers/promises";
import { createServer } from "vite";
import sharp from "sharp";
import convertImages from "../../vite-webp-avif-generator-plugin.js";
import { createCaptureLogger } from "./capture-logger.mjs";

const TTL_MS = 24 * 60 * 60 * 1000;
const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`  ${condition ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 25 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return true;
    await delay(intervalMs);
  }
  return false;
}

async function main() {
  console.log("Running incomplete staging cleanup checks...");
  const scratchRoot = await mkdtemp(join(tmpdir(), "vite-webp-avif-generator-cleanup-"));
  const imageDir = resolve(scratchRoot, "public/img");
  const excludedDir = resolve(imageDir, "excluded");
  const staleOwned = resolve(
    imageDir,
    "stale.webp.vite-webp-avif-generator.0123456789abcdef.incomplete"
  );
  const freshOwned = resolve(
    imageDir,
    "fresh.avif.vite-webp-avif-generator.fedcba9876543210.incomplete"
  );
  const excludedOwned = resolve(
    excludedDir,
    "excluded.webp.vite-webp-avif-generator.1111111111111111.incomplete"
  );
  const malformedOwned = resolve(
    imageDir,
    "malformed.webp.vite-webp-avif-generator.not-hex.incomplete"
  );
  const foreignIncomplete = resolve(imageDir, "manual.incomplete");
  const legacyTemp = resolve(imageDir, "legacy.webp.12345678.tmp");
  const recoverySource = resolve(imageDir, "recovery.png");
  const recoveryTarget = resolve(imageDir, "recovery.webp");
  const oldDate = new Date(Date.now() - TTL_MS - 60_000);
  const capture = createCaptureLogger();
  let server;

  try {
    await mkdir(excludedDir, { recursive: true });
    for (const filePath of [
      staleOwned,
      freshOwned,
      excludedOwned,
      malformedOwned,
      foreignIncomplete,
      legacyTemp
    ]) {
      await writeFile(filePath, filePath);
    }
    for (const filePath of [
      staleOwned,
      excludedOwned,
      malformedOwned,
      foreignIncomplete,
      legacyTemp
    ]) {
      await utimes(filePath, oldDate, oldDate);
    }

    server = await createServer({
      root: scratchRoot,
      publicDir: resolve(scratchRoot, "public"),
      configFile: false,
      customLogger: capture.logger,
      server: { middlewareMode: true },
      plugins: [
        convertImages({
          folders: ["public/img"],
          exclude: ["public/img/excluded"],
          enableInitialPass: false,
          enableAvif: false
        })
      ]
    });

    const cleanupFinished = await waitFor(() => !existsSync(staleOwned));
    check("stale plugin-owned file is removed", cleanupFinished);
    check("fresh plugin-owned file is preserved", existsSync(freshOwned));
    check("excluded plugin-owned file is preserved", existsSync(excludedOwned));
    check("malformed plugin-like file is preserved", existsSync(malformedOwned));
    check("foreign .incomplete file is preserved", existsSync(foreignIncomplete));
    check("legacy opaque .tmp file is preserved", existsSync(legacyTemp));
    check(
      "cleanup summary is logged",
      capture.text().includes("Removed 1 stale incomplete conversion file(s)")
    );

    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 20, g: 120, b: 220 }
      }
    })
      .png()
      .toFile(recoverySource);
    const recoveryConverted = await waitFor(() => existsSync(recoveryTarget));
    check("watcher still converts after cleanup", recoveryConverted);
  } finally {
    if (server) await server.close();
    await rm(scratchRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  const passed = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);
  console.log(`Results: ${passed}/${results.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add the focused script to the verification gate**

Insert it after `test-active-work-cleanup.mjs` and before `run-tests.mjs`:

```json
"verify": "node --check vite-webp-avif-generator-plugin.js && node playground/scripts/test-format-options.mjs && node playground/scripts/test-output-naming.mjs && node playground/scripts/test-active-work-cleanup.mjs && node playground/scripts/test-incomplete-cleanup.mjs && node playground/scripts/run-tests.mjs && node playground/scripts/test-logging.mjs && node playground/scripts/test-nuxt-srcdir-public.mjs && node playground/scripts/test-nuxt-watcher-cleanup.mjs && node playground/scripts/test-race-initial-pass.mjs && npm audit --omit=dev && npm pack --dry-run --ignore-scripts"
```

- [ ] **Step 3: Run the new test and verify the red state**

Run:

```powershell
node playground/scripts/test-incomplete-cleanup.mjs
```

Expected: exit code `1`; `stale plugin-owned file is removed` and `cleanup summary is logged` fail because runtime cleanup does not exist.

- [ ] **Step 4: Add only the required runtime constants and ownership predicate**

Change the import and constants:

```js
import { lstat, readdir, rename, rm } from "fs/promises";

const MIN_BULK_CONCURRENCY = 4;
const LOG_LABEL = "[vite-webp-avif-generator]";
const INCOMPLETE_FILE_TTL_MS = 24 * 60 * 60 * 1000;
const INCOMPLETE_FILE_PATTERN =
  /^.+\.vite-webp-avif-generator\.[0-9a-f]{16}\.incomplete$/;
```

Add the private predicate near the other path helpers:

```js
/**
 * Check whether a path uses the reserved plugin-owned incomplete filename.
 * @param {string} filePath - Candidate absolute file path
 * @returns {boolean}
 */
function isPluginOwnedIncompletePath(filePath) {
  return INCOMPLETE_FILE_PATTERN.test(basename(filePath));
}
```

- [ ] **Step 5: Add the minimal stale-cleanup function**

Place this after `listFilesRecursively` so its filesystem responsibility remains next to the existing scanner:

```js
/**
 * Remove stale plugin-owned incomplete files from watched, non-excluded folders.
 * @param {string[]} watchPaths - Absolute watched folder paths
 * @param {string[]} exclude - Absolute excluded folder paths
 * @param {import("vite").Logger} logger - Vite logger
 * @returns {Promise<void>}
 */
async function cleanupStaleIncompleteFiles(watchPaths, exclude, logger) {
  const filesByFolder = await Promise.all(
    watchPaths.map((folder) => (existsSync(folder) ? listFilesRecursively(folder, logger) : []))
  );
  const candidates = [
    ...new Map(
      filesByFolder
        .flat()
        .filter(
          (filePath) =>
            isPluginOwnedIncompletePath(filePath) &&
            !isInExcludedFolder(filePath, exclude)
        )
        .map((filePath) => [normalizeComparisonPath(filePath), filePath])
    ).values()
  ];
  const staleBefore = Date.now() - INCOMPLETE_FILE_TTL_MS;
  let removed = 0;

  await runWithConcurrencyLimit(candidates, MIN_BULK_CONCURRENCY, async (filePath) => {
    try {
      const fileStats = await lstat(filePath);
      if (!fileStats.isFile() || fileStats.mtimeMs > staleBefore) return;
      await rm(filePath);
      removed += 1;
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.warn(
          `${LOG_LABEL} Failed to clean incomplete file ${filePath}: ${error.message}`
        );
      }
    }
  });

  if (removed > 0) {
    logger.info(`${LOG_LABEL} Removed ${removed} stale incomplete conversion file(s)`);
  }
}
```

- [ ] **Step 6: Run cleanup on every watcher ready event**

Replace the conditional ready handler with one tracked startup task:

```js
watcher.once("ready", () => {
  const startupTask = (async () => {
    await cleanupStaleIncompleteFiles(watchPaths, resolvedExclude, logger);
    if (enableInitialPass) {
      await runInitialPass(
        watchPaths,
        handlerOptions,
        (filePath, overrides) => processFileOnce(filePath, overrides)
      );
    }
  })();

  void trackTask(startupTask).catch((error) => {
    logger.error(`${LOG_LABEL} Startup processing failed: ${error.message}`);
  });
});
```

Do not change watcher options, `processFileOnce`, active-task tracking, or `server.close`.

- [ ] **Step 7: Verify the focused cleanup behavior**

Run:

```powershell
node --check vite-webp-avif-generator-plugin.js
node playground/scripts/test-incomplete-cleanup.mjs
node playground/scripts/test-active-work-cleanup.mjs
```

Expected: syntax exit `0`; cleanup test `8/8 passed`; active-work cleanup remains fully passing.

- [ ] **Step 8: Commit Task 1**

```powershell
git add vite-webp-avif-generator-plugin.js playground/scripts/test-incomplete-cleanup.mjs package.json
git commit -m "feat: clean stale incomplete conversion files"
```

---

### Task 2: Diagnostic Staging Name And Deterministic Interrupt Regression

**Files:**
- Modify: `vite-webp-avif-generator-plugin.js:293-333`
- Modify: `playground/scripts/test-format-options.mjs:240-265`
- Modify: `playground/scripts/run-tests.mjs:1-240`
- Modify: `playground/scripts/run-tests.mjs:562-600`

**Interfaces:**
- Consumes: the exact ownership pattern introduced by Task 1.
- Produces: `createIncompletePath(targetPath): string`.
- Preserves: Sharp options, target path calculation, atomic `rename`, and `"converted" | "skipped"` results.

- [ ] **Step 1: Add event-driven interrupt-test helpers**

In `run-tests.mjs`, add:

```js
import { randomBytes } from "crypto";
import sharp from "sharp";

const INCOMPLETE_FILE_PATTERN =
  /^.+\.vite-webp-avif-generator\.[0-9a-f]{16}\.incomplete$/;

async function waitFor(predicate, { timeoutMs = 30000, intervalMs = 10 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await delay(intervalMs);
  }
  return undefined;
}

async function createInterruptFixture(filePath) {
  const width = 2200;
  const height = 2200;
  const channels = 3;
  await mkdir(dirname(filePath), { recursive: true });
  await sharp(randomBytes(width * height * channels), {
    raw: { width, height, channels }
  })
    .png({ compressionLevel: 0 })
    .toFile(filePath);
}
```

- [ ] **Step 2: Extend the existing generated-config helper for the slow AVIF case**

Extend `writeConfig(overrides)` with `avifOptions` and render it only when provided:

```js
const {
  folders = ["src/img", "public/img"],
  exclude = ["src/img/excluded", "public/img/excluded"],
  enableAvif = true,
  enableInitialPass = true,
  avifOptions
} = overrides;
```

```js
      enableInitialPass: ${enableInitialPass}${
        avifOptions ? `,\n      avifOptions: ${JSON.stringify(avifOptions)}` : ""
      }
```

- [ ] **Step 3: Replace the interrupt section with the isolated crash scenario**

Delete `removeTemporaryOutputs`; Section 12 will own and remove its isolated directory.

Replace `testSection12()` with:

```js
async function testSection12() {
  console.log("\n## 12. Atomic write / interrupt");
  const testDir = resolve(root, "src/img/interrupt-test");
  const sourcePath = resolve(testDir, "slow.png");
  const configPath = resolve(root, "scripts/.test-interrupt.config.js");
  let child;

  await rm(testDir, { recursive: true, force: true });
  await createInterruptFixture(sourcePath);
  await writeFile(
    configPath,
    writeConfig({
      folders: ["src/img/interrupt-test"],
      exclude: [],
      enableAvif: true,
      enableInitialPass: true,
      avifOptions: { effort: 9 }
    })
  );

  try {
    child = spawn(process.execPath, [viteBinPath, "--config", configPath], {
      cwd: repoRoot,
      stdio: "ignore"
    });

    const observedIncomplete = await waitFor(async () => {
      const entries = await readdir(testDir);
      return entries.find((entry) => INCOMPLETE_FILE_PATTERN.test(entry));
    });

    if (observedIncomplete) {
      pass("12", "Diagnostic incomplete filename observed", observedIncomplete);
    } else {
      fail("12", "Diagnostic incomplete filename observed");
      return;
    }

    child.kill("SIGKILL");
    await new Promise((resolveExit) => {
      if (child.exitCode !== null) resolveExit();
      else child.once("exit", resolveExit);
    });
    child = undefined;

    const entries = await readdir(testDir);
    const incompleteFiles = entries.filter((entry) =>
      INCOMPLETE_FILE_PATTERN.test(entry)
    );
    if (incompleteFiles.length > 0) {
      pass("12", "Interrupted conversion remains visibly incomplete", incompleteFiles.join(", "));
    } else {
      fail("12", "Interrupted conversion remains visibly incomplete");
    }

    let finalTargetsAreValid = true;
    for (const targetPath of [
      resolve(testDir, "slow.webp"),
      resolve(testDir, "slow.avif")
    ]) {
      if (!await exists(targetPath)) continue;
      try {
        await sharp(targetPath).metadata();
      } catch {
        finalTargetsAreValid = false;
      }
    }
    if (finalTargetsAreValid) {
      pass("12", "Published targets are absent or decodable");
    } else {
      fail("12", "Published targets are absent or decodable");
    }
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
      await new Promise((resolveExit) => child.once("exit", resolveExit));
    }
    await rm(configPath, { force: true });
    await rm(testDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
```

- [ ] **Step 4: Update the representative caught-failure assertion**

In `test-format-options.mjs`, replace the old `.tmp`-only check:

```js
const hasStagingFile = entries.some(
  (entry) =>
    entry.endsWith(".tmp") ||
    /^.+\.vite-webp-avif-generator\.[0-9a-f]{16}\.incomplete$/.test(entry)
);
check("failed conversion leaves no staging file", !hasStagingFile);
```

- [ ] **Step 5: Run the corrected regressions and verify the red state**

Run:

```powershell
node playground/scripts/run-tests.mjs
```

Expected: exit code `1`; Section 12 cannot observe the diagnostic pattern because runtime still creates opaque `.<8-hex>.tmp`.

Run:

```powershell
node playground/scripts/test-format-options.mjs
```

Expected: the existing caught-failure suite remains passing, confirming the failure is isolated to the crash-name contract.

- [ ] **Step 6: Add the single-purpose staging-path creator**

Near `convertImage`, add:

```js
/**
 * Build a unique, self-describing staging path beside the final target.
 * @param {string} targetPath - Final output path
 * @returns {string}
 */
function createIncompletePath(targetPath) {
  return (
    `${targetPath}.vite-webp-avif-generator.` +
    `${randomBytes(8).toString("hex")}.incomplete`
  );
}
```

Change only the staging assignment in `convertImage`:

```js
const tempPath = createIncompletePath(targetPath);
```

Do not alter the `existsSync` check, Sharp pipeline, `rename`, catch cleanup, result values, or logs.

- [ ] **Step 7: Verify focused conversion and interrupt behavior**

Run:

```powershell
node --check vite-webp-avif-generator-plugin.js
node playground/scripts/test-format-options.mjs
node playground/scripts/test-incomplete-cleanup.mjs
node playground/scripts/run-tests.mjs
```

Expected: every command exits `0`; Section 12 observes a plugin-owned `.incomplete`, leaves it after `SIGKILL`, and validates any published target with Sharp rather than file size.

- [ ] **Step 8: Verify no accidental Git residue**

Run:

```powershell
git status --short --untracked-files=all
```

Expected: only the planned source and test files are listed; no `interrupt-test`, generated image, test config, `.tmp`, or `.incomplete` artifact remains.

- [ ] **Step 9: Commit Task 2**

```powershell
git add vite-webp-avif-generator-plugin.js playground/scripts/run-tests.mjs playground/scripts/test-format-options.mjs
git commit -m "fix: expose interrupted image conversions"
```

---

### Task 3: User Documentation

**Files:**
- Modify: `README.md:6-15`
- Modify: `README.md:198-215`
- Modify: `CHANGELOG.md:10-35`

**Interfaces:**
- Consumes: exact runtime filename and TTL from Tasks 1-2.
- Produces: no runtime interface.
- Preserves: options table, usage examples, compatibility ranges, and package contents.

- [ ] **Step 1: Update the README feature summary**

Replace the atomic-write bullet with:

```markdown
- Publishes converted files atomically and leaves a clearly named `.incomplete` diagnostic after an abrupt interruption
```

- [ ] **Step 2: Replace the atomic behavior paragraph**

Use this exact behavior text:

```markdown
Files are converted atomically. Each output is first written beside its target with a
name such as
`image.webp.vite-webp-avif-generator.a1b2c3d4e5f60708.incomplete`, then renamed to
`image.webp` only after Sharp finishes successfully. Vite and the watcher do not treat
the `.incomplete` suffix as an image source.

Ordinary caught errors remove their staging file best-effort. If the process is stopped
abruptly, for example with `SIGKILL`, cleanup cannot run and the self-describing file may
remain in the working tree. It is intentionally not covered by a plugin-specific
`.gitignore` rule: its presence tells the developer that publication did not complete,
and it must not be used or committed as an image.

Whenever the watcher becomes ready, the plugin removes only files matching its exact
owned `.incomplete` pattern that are at least 24 hours old. Fresh files, arbitrary
`.incomplete` or `.tmp` files, excluded folders, and symlinks are left untouched.
```

- [ ] **Step 3: Update the current changelog**

Add these bullets under `2.4.0`:

```markdown
- Replaced opaque atomic-write temp names with self-describing plugin-owned
  `.incomplete` names, while keeping target-local staging and atomic rename publication.
- Added conservative startup cleanup for exact plugin-owned `.incomplete` files older
  than 24 hours; foreign, fresh, excluded, and symlinked entries are preserved.
- Corrected the forced-interruption regression to accept the unavoidable diagnostic
  artifact after `SIGKILL` and validate any published image by decoding it with Sharp.
```

- [ ] **Step 4: Check documentation consistency**

Run:

```powershell
rg -n "atomic|incomplete|24 hours|gitignore|cacheDir" README.md CHANGELOG.md
git diff --check
```

Expected: README and changelog describe target-local `.incomplete`; they do not claim crash cleanup is possible and do not introduce `cacheDir`.

- [ ] **Step 5: Commit Task 3**

```powershell
git add README.md CHANGELOG.md
git commit -m "docs: explain incomplete conversion artifacts"
```

---

### Task 4: Pre-Regression Scope And Semantic Review

**Files:**
- Review only all files changed after the plan commit.
- Modify only a previously planned file if the review finds a concrete defect.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: a reviewed candidate approved for broad regression.

- [ ] **Step 1: Confirm the change surface**

Derive the plan commit and list later changes:

```powershell
$baseline = git rev-list -1 --grep="docs: add visible incomplete staging plan" HEAD
git diff --name-only "$baseline..HEAD"
```

Expected implementation files only:

```text
CHANGELOG.md
README.md
package.json
playground/scripts/run-tests.mjs
playground/scripts/test-format-options.mjs
playground/scripts/test-incomplete-cleanup.mjs
vite-webp-avif-generator-plugin.js
```

- [ ] **Step 2: Prove untouched public and unrelated surfaces**

Run:

```powershell
git diff "$baseline..HEAD" -- .gitignore package-lock.json vite-webp-avif-generator-plugin.d.ts PUBLISHING.md playground/nuxt3-app playground/nuxt4-app
```

Expected: empty output.

- [ ] **Step 3: Review the runtime functions against single responsibilities**

Inspect:

```powershell
git diff "$baseline..HEAD" -- vite-webp-avif-generator-plugin.js
```

Approve only when all statements are true:

| Function | One responsibility | Forbidden expansion |
| --- | --- | --- |
| `createIncompletePath` | Construct one unique target-local staging path | No I/O, policy, logging, or target calculation |
| `isPluginOwnedIncompletePath` | Match the exact reserved basename | No filesystem reads or fuzzy substring ownership |
| `cleanupStaleIncompleteFiles` | Delete exact owned files older than TTL | No cache migration, PID logic, locks, retries, or foreign cleanup |
| `convertImage` | Existing encode and atomic publish orchestration | No new branches except calling the path creator |
| watcher `ready` handler | Cleanup, then optional initial pass | No change to watcher options or shutdown |

- [ ] **Step 4: Scan explicitly for prohibited complexity**

Run:

```powershell
$matches = rg -n "cacheDir|heartbeat|lockFile|lock file|process\.kill|fsync|hard.?link|copyFile.*target|retryDelay" vite-webp-avif-generator-plugin.js
if ($LASTEXITCODE -eq 1) { "No prohibited complexity found" } else { $matches }
```

Expected: `No prohibited complexity found`.

- [ ] **Step 5: Check semantic invariants before broad testing**

Confirm from the diff:

1. `rename(tempPath, targetPath)` is still the only publication operation.
2. `rm(tempPath, { force: true })` remains the caught-failure cleanup.
3. `.incomplete` is unsupported by `SUPPORTED_FORMATS`.
4. cleanup uses exact regex, regular-file results from the symlink-safe scanner, exclusions, and `mtimeMs`.
5. cleanup runs when `enableInitialPass` is false.
6. active tasks still include ready-time cleanup and initial-pass work.
7. no public option, dependency, or type declaration changed.

- [ ] **Step 6: Request an independent code review**

Dispatch one read-only reviewer with this exact scope:

```text
Review only the diff after the implementation-plan commit. Look for behavioral
regressions, accidental deletion risk, watcher lifecycle regressions, flaky interrupt
test logic, and unnecessary abstractions. Verify the exact ownership regex, 24-hour
boundary, exclusions, symlink behavior, cleanup ordering, and finally blocks. Do not
suggest unrelated refactors.
```

Expected: no P0-P2 findings. Any valid finding must be fixed in the smallest owning task, followed by that task's focused test and a dedicated fix commit.

- [ ] **Step 7: Run whitespace and repository-state checks**

```powershell
git diff --check
git status --short --untracked-files=all
```

Expected: no whitespace errors and no generated `.tmp`, `.incomplete`, image, config, or scratch artifacts.

---

### Task 5: Full Regression And Tabular Report

**Files:**
- Create: `docs/reviews/2026-07-26-visible-incomplete-staging-regression.md`
- Modify: none of the runtime or test files unless regression exposes a scoped defect.

**Interfaces:**
- Consumes: review-approved candidate from Task 4.
- Produces: verified release candidate and evidence table.

- [ ] **Step 1: Run syntax and focused verification after review**

```powershell
node --check vite-webp-avif-generator-plugin.js
node playground/scripts/test-incomplete-cleanup.mjs
node playground/scripts/test-format-options.mjs
node playground/scripts/test-active-work-cleanup.mjs
node playground/scripts/run-tests.mjs
```

Expected: every command exits `0`; no failed assertions.

- [ ] **Step 2: Run the complete release regression**

```powershell
npm test
```

Expected: exit code `0`, including all focused scripts, core regression, logging, Nuxt path resolution, Nuxt watcher cleanup, initial/live race, production dependency audit, and npm pack dry run.

- [ ] **Step 3: Verify final repository cleanliness**

```powershell
git diff --check
git status --short --untracked-files=all
```

Expected: no generated artifacts. Only the not-yet-committed regression report may be listed after Step 4.

- [ ] **Step 4: Write the regression report**

Create `docs/reviews/2026-07-26-visible-incomplete-staging-regression.md` in Russian. Include one flat table with these exact rows:

1. Syntax check.
2. Focused stale-cleanup test.
3. Representative caught Sharp failure.
4. Active-work shutdown regression.
5. Forced `SIGKILL` regression.
6. Full `npm test`.
7. Production dependency audit.
8. Npm package dry run.
9. Git worktree cleanliness.
10. Manual diff and independent review.

Use columns: `Область`, `Команда/проверка`, `Ожидание`, `Фактический результат`, `Статус`, `Подтверждение`. Record exact observed assertion counts, exit codes, skipped platform-specific cases, and any residual limitation. Do not mark a row passed without command output or review evidence.

- [ ] **Step 5: Commit the verified report**

```powershell
git add docs/reviews/2026-07-26-visible-incomplete-staging-regression.md
git commit -m "docs: add incomplete staging regression report"
```

- [ ] **Step 6: Final verification after the report commit**

```powershell
git status --short
git log -6 --oneline
```

Expected: clean worktree and a linear sequence of scoped commits for cleanup, diagnostic naming, documentation, any review fix, and regression evidence.

---

## Deliberate Non-Solutions

The implementation must not add any of the following:

| Rejected mechanism | Reason |
| --- | --- |
| Vite `cacheDir` staging | Reintroduces cross-filesystem and permission/ACL questions unrelated to the chosen visible diagnostic |
| `.gitignore` rule | Hides the developer-facing failure signal |
| PID/heartbeat ownership | Solves a conversion lasting longer than 24 hours at disproportionate complexity |
| Lock files or hard-link publication | Changes collision semantics and filesystem compatibility outside this defect |
| Per-errno retries | Adds timing and platform policy without evidence that the shared catch path is insufficient |
| Filesystem dependency injection | Expands architecture solely to synthesize rare errors already handled by one common rejection path |
| Public TTL option | Adds API surface for an internal safety constant without a demonstrated user need |
| General temp-file scavenger | Risks deleting files not created by this plugin |

## Completion Gate

Implementation is complete only when:

- Tasks 1-3 are committed independently and contain no unrelated changes.
- Task 4 approves the exact diff before the broad regression begins.
- The independent reviewer reports no unresolved P0-P2 findings.
- Task 5 completes with `npm test` exit code `0`.
- The regression report contains actual evidence, not inferred statuses.
- The final worktree is clean.
