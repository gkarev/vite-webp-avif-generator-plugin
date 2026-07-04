import { createServer } from "vite";
import { mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { setTimeout as delay } from "timers/promises";
import convertImages from "../../vite-webp-avif-generator-plugin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const playgroundRoot = resolve(__dirname, "..");
const scratchRoot = resolve(playgroundRoot, ".nuxt-srcdir-scratch");

const results = [];
function check(name, condition, detail = "") {
  results.push({ name, ok: !!condition, detail });
  console.log(`  ${condition ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function captureLogs() {
  const logs = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args) => {
    logs.push(args.join(" "));
    originalLog(...args);
  };
  console.warn = (...args) => {
    logs.push(args.join(" "));
    originalWarn(...args);
  };
  return {
    text: () => logs.join("\n"),
    restore: () => {
      console.log = originalLog;
      console.warn = originalWarn;
    }
  };
}

async function waitFor(predicate, { timeoutMs = 8000, intervalMs = 150 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await delay(intervalMs);
  }
  return false;
}

async function createFixture(fixturePath) {
  const sharp = (await import("sharp")).default;
  await mkdir(dirname(fixturePath), { recursive: true });
  await sharp({
    create: { width: 12, height: 12, channels: 3, background: { r: 10, g: 20, b: 30 } }
  })
    .png()
    .toFile(fixturePath);
}

/**
 * Case A: reproduces the real Nuxt condition — `root` shifted to a `srcDir`-like
 * subfolder and Vite's own `publicDir` forced to `false` (exactly what Nuxt's schema
 * does unconditionally, per `packages/schema/src/config/vite.ts`). Without the new
 * `publicDir` plugin option, `public/img` must NOT resolve to the real fixture folder.
 */
async function caseA_bugReproduction() {
  console.log("\n## Case A: Nuxt-like root+publicDir=false without the `publicDir` option");

  const caseDir = resolve(scratchRoot, "case-a");
  const appRoot = resolve(caseDir, "app");
  const fixture = resolve(caseDir, "public/img/fixture.png");
  await mkdir(appRoot, { recursive: true });
  await createFixture(fixture);

  const capture = captureLogs();
  const server = await createServer({
    root: appRoot,
    publicDir: false,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
    plugins: [convertImages({ folders: ["public/img"], enableInitialPass: true })]
  });

  const gotSummary = await waitFor(() => capture.text().includes("Initial pass complete"));
  capture.restore();

  check("AC-A1: initial pass summary is printed", gotSummary);
  const match = capture.text().match(/Initial pass complete: processed (\d+)/);
  check(
    "AC-A2: processed 0 — public/img wrongly resolves under srcDir",
    match && Number(match[1]) === 0,
    match ? match[0] : "no summary found"
  );
  check(
    "AC-A3: missing-folder warning is logged",
    capture.text().includes("Warning: watched folder \"public/img\" resolved to")
  );
  check(
    "AC-A4: fixture is not converted",
    !existsSync(resolve(caseDir, "public/img/fixture.webp"))
  );

  await server.close();
}

/**
 * Case B: same Nuxt-like condition as Case A, but with the explicit `publicDir`
 * plugin option pointing at the real public directory — proves the option fixes
 * the exact broken condition reproduced in Case A.
 */
async function caseB_fixVerification() {
  console.log("\n## Case B: same condition, with the `publicDir` option set");

  const caseDir = resolve(scratchRoot, "case-b");
  const appRoot = resolve(caseDir, "app");
  const fixture = resolve(caseDir, "public/img/fixture.png");
  await mkdir(appRoot, { recursive: true });
  await createFixture(fixture);

  const capture = captureLogs();
  const server = await createServer({
    root: appRoot,
    publicDir: false,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
    plugins: [
      convertImages({
        folders: ["public/img"],
        enableInitialPass: true,
        publicDir: resolve(caseDir, "public")
      })
    ]
  });

  const gotSummary = await waitFor(() => capture.text().includes("Initial pass complete"));
  capture.restore();

  check("AC-B1: initial pass summary is printed", gotSummary);
  const match = capture.text().match(/Initial pass complete: processed (\d+), converted (\d+)/);
  check(
    "AC-B2: processed 1, converted > 0 — publicDir option fixes resolution",
    match && Number(match[1]) === 1 && Number(match[2]) > 0,
    match ? match[0] : "no summary found"
  );
  check(
    "AC-B3: fixture is converted to webp and avif",
    existsSync(resolve(caseDir, "public/img/fixture.webp")) &&
      existsSync(resolve(caseDir, "public/img/fixture.avif"))
  );

  await server.close();
}

/**
 * Case C: standard, non-Nuxt Vite setup (matches `playground/vite.config.js`) with
 * `publicDir` unset on the plugin — proves the new option is purely additive and does
 * not change today's behavior for the common case.
 */
async function caseC_backwardCompatibility() {
  console.log("\n## Case C: standard Vite config, no `publicDir` option (backward compatibility)");

  const caseDir = resolve(scratchRoot, "case-c");
  const fixture = resolve(caseDir, "public/img/fixture.png");
  await mkdir(caseDir, { recursive: true });
  await createFixture(fixture);

  const capture = captureLogs();
  const server = await createServer({
    root: caseDir,
    publicDir: resolve(caseDir, "public"),
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
    plugins: [convertImages({ folders: ["public/img"], enableInitialPass: true })]
  });

  const gotSummary = await waitFor(() => capture.text().includes("Initial pass complete"));
  capture.restore();

  check("AC-C1: initial pass summary is printed", gotSummary);
  const match = capture.text().match(/Initial pass complete: processed (\d+), converted (\d+)/);
  check(
    "AC-C2: processed 1, converted > 0 — unchanged behavior for standard Vite publicDir",
    match && Number(match[1]) === 1 && Number(match[2]) > 0,
    match ? match[0] : "no summary found"
  );
  check(
    "AC-C3: no missing-folder warning for a correctly resolved standard setup",
    !capture.text().includes("Warning: watched folder")
  );

  await server.close();
}

async function main() {
  await rm(scratchRoot, { recursive: true, force: true });

  try {
    await caseA_bugReproduction();
    await caseB_fixVerification();
    await caseC_backwardCompatibility();
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log("\n========================================");
  console.log(`Results: ${passed}/${results.length} passed`);
  if (failed.length) {
    console.log("\nFailed:");
    for (const item of failed) {
      console.log(`  - ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exitCode = 1;
});
