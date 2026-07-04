import { createServer } from "vite";
import { mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { setTimeout as delay } from "timers/promises";
import convertImages from "../../vite-webp-avif-generator-plugin.js";
import { createCaptureLogger } from "./capture-logger.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const playgroundRoot = resolve(__dirname, "..");
const scratchRoot = resolve(playgroundRoot, ".logging-scratch");
const LABEL = "[vite-webp-avif-generator]";
const LEGACY_LABEL = "[Image Converter]";

const results = [];
function check(name, condition, detail = "") {
  results.push({ name, ok: !!condition, detail });
  console.log(`  ${condition ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitFor(predicate, { timeoutMs = 8000, intervalMs = 150 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true;
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

// Capture raw process stdio to verify the DEFAULT Vite logger (not our custom one).
function captureStdio() {
  const chunks = [];
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, ...rest) => {
    chunks.push(String(chunk));
    return stdoutWrite(chunk, ...rest);
  };
  process.stderr.write = (chunk, ...rest) => {
    chunks.push(String(chunk));
    return stderrWrite(chunk, ...rest);
  };
  return {
    text: () => chunks.join(""),
    restore: () => {
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
    }
  };
}

/**
 * Group 1: standard Vite — every top-level plugin line is prefixed with the
 * plugin label, routed through Vite's logger.
 */
async function group1_standardVite() {
  console.log("\n## Group 1: standard Vite — labeled output via Vite logger");

  const caseDir = resolve(scratchRoot, "standard");
  await createFixture(resolve(caseDir, "public/img/pic.png"));

  const capture = createCaptureLogger();
  const server = await createServer({
    root: caseDir,
    publicDir: resolve(caseDir, "public"),
    configFile: false,
    customLogger: capture.logger,
    server: { middlewareMode: true },
    plugins: [convertImages({ folders: ["public/img"], enableInitialPass: true })]
  });

  await waitFor(() => capture.text().includes("Initial pass complete"));
  await server.close();

  const text = capture.text();
  check("startup line is labeled", text.includes(`${LABEL} Starting file watcher`));
  check("watched-folders line is labeled", text.includes(`${LABEL} Watched folders:`));
  check("new-file line is labeled", text.includes(`${LABEL} New file detected`));
  check("summary line is labeled", text.includes(`${LABEL} Initial pass complete`));
  check("watcher-stop line is labeled", text.includes(`${LABEL} File watcher stopped`));
  check(
    "per-format line kept unlabeled by design",
    /\s(WEBP|AVIF): converted in \d+ms/.test(text)
  );
  check("no legacy label remains", !text.includes(LEGACY_LABEL));
  check(
    "fixture converted",
    existsSync(resolve(caseDir, "public/img/pic.webp")) &&
      existsSync(resolve(caseDir, "public/img/pic.avif"))
  );
}

/**
 * Group 2: Nuxt-like conditions (Vite `publicDir: false`), covering both the
 * fixed case (explicit `publicDir` option) and the labeled missing-folder
 * warning with `warnOnce` de-duplication.
 */
async function group2_nuxtLike() {
  console.log("\n## Group 2: Nuxt-like (publicDir: false)");

  // 2a: explicit publicDir option -> conversion works, labeled summary, no warning.
  const fixedDir = resolve(scratchRoot, "nuxt-fixed");
  const appRoot = resolve(fixedDir, "app");
  await mkdir(appRoot, { recursive: true });
  await createFixture(resolve(fixedDir, "public/img/pic.png"));

  const fixed = createCaptureLogger();
  const fixedServer = await createServer({
    root: appRoot,
    publicDir: false,
    configFile: false,
    customLogger: fixed.logger,
    server: { middlewareMode: true },
    plugins: [
      convertImages({
        folders: ["public/img"],
        enableInitialPass: true,
        publicDir: resolve(fixedDir, "public")
      })
    ]
  });

  await waitFor(() => fixed.text().includes("Initial pass complete"));
  await fixedServer.close();

  check("2a: labeled summary with publicDir option", fixed.text().includes(`${LABEL} Initial pass complete`));
  check(
    "2a: fixture converted via publicDir option",
    existsSync(resolve(fixedDir, "public/img/pic.webp"))
  );
  check("2a: no missing-folder warning", !fixed.text().includes("Warning: watched folder"));

  // 2b: no publicDir option, duplicated missing folder -> one labeled warnOnce.
  const brokenDir = resolve(scratchRoot, "nuxt-broken", "app");
  await mkdir(brokenDir, { recursive: true });

  const broken = createCaptureLogger();
  const brokenServer = await createServer({
    root: brokenDir,
    publicDir: false,
    configFile: false,
    customLogger: broken.logger,
    server: { middlewareMode: true },
    plugins: [convertImages({ folders: ["public/img", "public/img"], enableInitialPass: true })]
  });

  await waitFor(() => broken.text().includes("Initial pass complete"));
  await brokenServer.close();

  const warnings = broken.count(`${LABEL} Warning: watched folder`);
  check("2b: missing-folder warning is labeled", warnings >= 1);
  check("2b: warnOnce de-duplicates identical warning", warnings === 1, `count=${warnings}`);
}

/**
 * Group 3: the plugin honors Vite's `logLevel` because it logs through the
 * resolved logger instead of raw `console`.
 */
async function group3_logLevelRespected() {
  console.log("\n## Group 3: default logger honors logLevel");

  // silent: work still runs, but nothing is printed to stdio.
  const silentDir = resolve(scratchRoot, "silent");
  await createFixture(resolve(silentDir, "public/img/pic.png"));

  const silentCapture = captureStdio();
  let converted = false;
  try {
    const server = await createServer({
      root: silentDir,
      publicDir: resolve(silentDir, "public"),
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true },
      plugins: [convertImages({ folders: ["public/img"], enableInitialPass: true })]
    });
    converted = await waitFor(() => existsSync(resolve(silentDir, "public/img/pic.webp")));
    await server.close();
  } finally {
    silentCapture.restore();
  }

  check("silent: conversion still runs", converted);
  check("silent: no plugin output on stdio", !silentCapture.text().includes(LABEL));

  // info (default): the default logger prints labeled output to stdout.
  const infoDir = resolve(scratchRoot, "info");
  await createFixture(resolve(infoDir, "public/img/pic.png"));

  const infoCapture = captureStdio();
  let printed = false;
  try {
    const server = await createServer({
      root: infoDir,
      publicDir: resolve(infoDir, "public"),
      configFile: false,
      logLevel: "info",
      server: { middlewareMode: true },
      plugins: [convertImages({ folders: ["public/img"], enableInitialPass: true })]
    });
    printed = await waitFor(() => infoCapture.text().includes(`${LABEL} Initial pass complete`));
    await server.close();
  } finally {
    infoCapture.restore();
  }

  check("info: default logger prints labeled output", printed);
}

async function main() {
  console.log("Running logging checks...");
  await rm(scratchRoot, { recursive: true, force: true });

  try {
    await group1_standardVite();
    await group2_nuxtLike();
    await group3_logLevelRespected();
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
