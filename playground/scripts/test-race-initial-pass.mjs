import { spawn } from "child_process";
import { copyFile, mkdir, readdir, rm, stat } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { setTimeout as delay } from "timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..");
const configPath = resolve(root, "vite.config.js");
// Spawn the Vite binary directly for cross-platform behavior (Windows `npx` is a
// `.cmd` shim that `spawn` cannot exec without a shell).
const viteBinPath = resolve(repoRoot, "node_modules/vite/bin/vite.js");
const BULK_COUNT = 80;
const raceBase = "race-during-initial-pass";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function killPort5173() {
  // Best-effort; `lsof` is absent on Windows, so no-op there rather than crash.
  if (process.platform === "win32") {
    return;
  }
  try {
    const child = spawn("lsof", ["-ti:5173"]);
    const pids = await new Promise((res) => {
      let data = "";
      child.on("error", () => res(""));
      child.stdout.on("data", (c) => (data += c));
      child.on("close", () => res(data.trim()));
    });
    for (const pid of pids.split("\n").filter(Boolean)) {
      process.kill(Number(pid), "SIGKILL");
    }
  } catch {
    // ignore
  }
}

async function prepare() {
  await new Promise((res, rej) => {
    const p = spawn("node", ["playground/scripts/create-fixtures.mjs"], { cwd: repoRoot });
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error("fixtures failed"))));
  });

  const bulkDir = resolve(root, "src/img/bulk-load");
  await rm(bulkDir, { recursive: true, force: true });
  await mkdir(bulkDir, { recursive: true });

  const source = resolve(root, "src/img/initial-pass/fresh.png");
  for (let i = 1; i <= BULK_COUNT; i++) {
    const name = `bulk-${String(i).padStart(3, "0")}.png`;
    await copyFile(source, resolve(bulkDir, name));
  }

  const liveAdd = resolve(root, "src/img/live-add");
  await mkdir(liveAdd, { recursive: true });
  for (const ext of ["webp", "avif", "png"]) {
    await rm(resolve(liveAdd, `${raceBase}.${ext}`), { force: true });
  }

  async function removeDerivatives(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await removeDerivatives(full);
      } else if (/\.(webp|avif)$/i.test(entry.name)) {
        await rm(full, { force: true });
      }
    }
  }

  await removeDerivatives(resolve(root, "src/img"));
  await removeDerivatives(resolve(root, "public/img"));
}

async function main() {
  console.log("Race test: initial pass + live add\n");
  await killPort5173();
  await prepare();

  const output = [];
  let raceFileDropped = false;

  const child = spawn(process.execPath, [viteBinPath, "--config", configPath], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    output.push(text);
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    output.push(text);
    process.stderr.write(text);
  });

  const started = Date.now();
  while (Date.now() - started < 120000) {
    const log = output.join("");
    const bulkCount = (log.match(/New file detected: src\/img\/bulk-load/g) || []).length;

    if (!raceFileDropped && bulkCount >= 25 && log.includes("ready in")) {
      raceFileDropped = true;
      await copyFile(
        resolve(root, "src/img/initial-pass/fresh.png"),
        resolve(root, `src/img/live-add/${raceBase}.png`)
      );
      console.log(`\n>>> Race file dropped after ${bulkCount} bulk detections (during initial pass)\n`);
    }

    const raceWebp = resolve(root, `src/img/live-add/${raceBase}.webp`);
    if (log.includes("Initial pass complete") && raceFileDropped && (await exists(raceWebp))) {
      break;
    }
    if (log.includes("Initial pass complete") && raceFileDropped && Date.now() - started > 25000) {
      break;
    }
    await delay(200);
  }

  await delay(2000);

  const log = output.join("");
  const summaryIdx = log.indexOf("Initial pass complete");
  const raceIdx = log.indexOf(`New file detected: src/img/live-add/${raceBase}.png`);
  const raceWebp = resolve(root, `src/img/live-add/${raceBase}.webp`);
  const raceAvif = resolve(root, `src/img/live-add/${raceBase}.avif`);

  child.kill("SIGINT");
  await delay(1000);

  console.log("\n========================================");
  console.log("Results:\n");

  const checks = [
    [
      "Race file dropped during initial pass",
      raceFileDropped,
      raceFileDropped ? `after bulk-load processing started` : "bulk-load never triggered drop"
    ],
    [
      "Live watcher detected race file",
      raceIdx >= 0,
      raceIdx >= 0 ? "log present" : "no log"
    ],
    [
      "Race file detected BEFORE initial pass complete",
      raceIdx >= 0 && summaryIdx >= 0 && raceIdx < summaryIdx,
      raceIdx >= 0 && summaryIdx >= 0
        ? `race log at ${raceIdx}, summary at ${summaryIdx}`
        : "order unclear"
    ],
    [`${raceBase}.webp created`, await exists(raceWebp)],
    [`${raceBase}.avif created`, await exists(raceAvif)]
  ];

  let failed = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failed += 1;
  }

  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
