import { createServer } from "vite";
import { writeFile, rm, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import convertImages from "../../vite-webp-avif-generator-plugin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const playgroundRoot = resolve(__dirname, "..");
const scratchDir = resolve(playgroundRoot, ".nuxt-scratch");

const results = [];
function check(name, condition, detail = "") {
  results.push({ name, ok: !!condition, detail });
  console.log(`  ${condition ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function captureLogs() {
  const logs = [];
  const original = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
    original(...args);
  };
  return {
    logs,
    restore: () => {
      console.log = original;
    }
  };
}

function countStoppedLogs(logs) {
  return logs.filter((l) => l.includes("File watcher stopped")).length;
}

async function scenarioB_middlewareMode() {
  console.log("\n## Scenario B: middleware mode (Nuxt-like, httpServer === null)");

  await mkdir(scratchDir, { recursive: true });

  const server = await createServer({
    root: playgroundRoot,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
    plugins: [convertImages({ folders: [".nuxt-scratch"] })]
  });

  check("AC-001 precondition: httpServer is null in middleware mode", server.httpServer === null);

  const capture = captureLogs();
  await server.close();
  capture.restore();
  const stoppedOnFirstClose = countStoppedLogs(capture.logs);
  check(
    "AC-001: watcher.close() invoked exactly once via wrapped server.close() in middleware mode",
    stoppedOnFirstClose === 1,
    `count=${stoppedOnFirstClose}`
  );

  const capture2 = captureLogs();
  let threwOnSecondClose = false;
  try {
    await server.close();
  } catch {
    threwOnSecondClose = true;
  }
  capture2.restore();
  const stoppedOnSecondClose = countStoppedLogs(capture2.logs);
  check(
    "AC-004: repeated close() does not re-invoke watcher.close() and does not throw",
    stoppedOnSecondClose === 0 && !threwOnSecondClose,
    `count=${stoppedOnSecondClose}, threw=${threwOnSecondClose}`
  );
}

async function scenarioC_restart() {
  console.log("\n## Scenario C: dev server restart in the same process (no orphaned watchers)");

  const server = await createServer({
    root: playgroundRoot,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
    plugins: [convertImages({ folders: [".nuxt-scratch"] })]
  });

  const capture = captureLogs();
  await server.restart();
  capture.restore();
  const stoppedOnRestart = countStoppedLogs(capture.logs);
  check(
    "AC-003: watcher.close() fires on restart, cleanup path is exercised",
    stoppedOnRestart === 1,
    `count=${stoppedOnRestart}`
  );

  const probeFile = resolve(scratchDir, "after-restart.png");
  const sharp = (await import("sharp")).default;
  await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 5, g: 5, b: 5 } }
  })
    .png()
    .toFile(probeFile);

  await sleep(1500);

  const converted =
    existsSync(resolve(scratchDir, "after-restart.webp")) &&
    existsSync(resolve(scratchDir, "after-restart.avif"));
  check("A watcher is still active and converting after restart (no dead server)", converted);

  const capture3 = captureLogs();
  await server.close();
  capture3.restore();
  const stoppedOnFinalClose = countStoppedLogs(capture3.logs);
  check(
    "No orphaned watcher: final close stops exactly the post-restart watcher, none leaked",
    stoppedOnFinalClose === 1,
    `count=${stoppedOnFinalClose}`
  );
}

async function main() {
  await rm(scratchDir, { recursive: true, force: true });

  try {
    await scenarioB_middlewareMode();
    await scenarioC_restart();
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
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
