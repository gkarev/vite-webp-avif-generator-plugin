import { spawn } from "child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { setTimeout as delay } from "timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..");
const results = [];
// Spawn the vite binary directly (instead of via `npx`) so the spawned
// process is the actual Vite dev server, not an npx wrapper process that
// could exit on SIGTERM while leaving an orphaned Vite grandchild behind.
const viteBinPath = resolve(repoRoot, "node_modules/vite/bin/vite.js");

function pass(section, name, detail = "") {
  results.push({ section, name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(section, name, detail = "") {
  results.push({ section, name, ok: false, detail });
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function runVite(configPath, { until, timeoutMs = 30000, env = {} } = {}) {
  const output = [];
  const child = spawn(
    process.execPath,
    [viteBinPath, "--config", configPath],
    {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

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

  const log = () => output.join("");

  if (until) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (until(log())) {
        return { child, log, stop: () => stopChild(child) };
      }
      await delay(200);
    }
    await stopChild(child);
    throw new Error(`Timeout waiting for: ${until}`);
  }

  return { child, log, stop: () => stopChild(child) };
}

async function stopChild(child) {
  if (child.killed || child.exitCode !== null) {
    return child.exitCode ?? 0;
  }

  // Vite's dev server only registers a SIGTERM listener for graceful shutdown
  // (see setupSIGTERMListener in vite's server bootstrap); SIGINT has no
  // built-in handler and would just kill the process without running
  // closeBundle, so it never exercises the watcher cleanup path.
  child.kill("SIGTERM");
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 3000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code ?? 0);
    });
  });
}

async function killPort5173() {
  // Best-effort cleanup of a stale dev server on the default Vite port. Uses
  // `lsof`, which is absent on Windows, so degrade to a no-op there instead of
  // crashing the run on the unhandled child "error" event.
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
    if (pids) {
      for (const pid of pids.split("\n")) {
        process.kill(Number(pid), "SIGKILL");
      }
      await delay(500);
    }
  } catch {
    // ignore
  }
}

async function resetFixtures() {
  await rm(resolve(root, "src/img"), { recursive: true, force: true });
  await rm(resolve(root, "public/img"), { recursive: true, force: true });
  await new Promise((res, rej) => {
    const p = spawn("node", ["playground/scripts/create-fixtures.mjs"], { cwd: repoRoot });
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error("fixtures failed"))));
  });
}

async function hasSibling(dirPath, base, extensions) {
  for (const extension of extensions) {
    if (await exists(resolve(dirPath, `${base}${extension}`))) {
      return true;
    }
  }
  return false;
}

async function removeDerivatives() {
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }

      const match = entry.name.match(/^(.+)\.(webp|avif)$/i);
      if (!match) {
        continue;
      }

      const base = match[1];
      const ext = match[2].toLowerCase();
      const dirPath = dirname(full);
      const hasRasterSource = await hasSibling(dirPath, base, [".png", ".jpg", ".jpeg"]);

      if (ext === "webp" && hasRasterSource) {
        await rm(full, { force: true });
      }

      if (ext === "avif" && (hasRasterSource || (await hasSibling(dirPath, base, [".webp"])))) {
        await rm(full, { force: true });
      }
    }
  }

  await walk(resolve(root, "src/img"));
  await walk(resolve(root, "public/img"));
}

async function removeTemporaryOutputs() {
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".tmp")) {
        await rm(full, { force: true });
      }
    }
  }

  await walk(resolve(root, "src/img"));
  await walk(resolve(root, "public/img"));
}

function writeConfig(overrides = {}) {
  const {
    folders = ["src/img", "public/img"],
    exclude = ["src/img/excluded", "public/img/excluded"],
    enableAvif = true,
    enableInitialPass = true
  } = overrides;

  return `import { defineConfig } from "vite";
import { resolve } from "path";
import convertImages from "../../vite-webp-avif-generator-plugin.js";

export default defineConfig({
  root: resolve(import.meta.dirname, ".."),
  publicDir: resolve(import.meta.dirname, "../public"),
  plugins: [
    convertImages({
      folders: ${JSON.stringify(folders)},
      exclude: ${JSON.stringify(exclude)},
      enableAvif: ${enableAvif},
      enableInitialPass: ${enableInitialPass}
    })
  ]
});
`;
}

const defaultConfigPath = resolve(root, "vite.config.js");

async function testSection1() {
  console.log("\n## 1. Initial pass");
  const session = await runVite(defaultConfigPath, {
    until: (log) => log.includes("Initial pass complete")
  });
  const log = session.log();

  if (log.includes("[vite-webp-avif-generator] Starting file watcher")) pass("1", "Watcher started");
  else fail("1", "Watcher started");

  if (log.includes("Excluded folders: src/img/excluded, public/img/excluded")) {
    pass("1", "Excluded folders logged");
  } else fail("1", "Excluded folders logged");

  const checks = [
    ["src/img/initial-pass/fresh.webp", "fresh.webp"],
    ["src/img/initial-pass/fresh.avif", "fresh.avif"],
    ["src/img/initial-pass/fresh-alt.webp", "fresh-alt.webp"],
    ["src/img/initial-pass/fresh-alt.avif", "fresh-alt.avif"],
    ["public/img/initial-pass/public-fresh.webp", "public-fresh.webp"],
    ["public/img/initial-pass/public-fresh.avif", "public-fresh.avif"],
    ["src/img/nested/deep/nested.webp", "nested.webp"],
    ["src/img/nested/deep/nested.avif", "nested.avif"],
    ["src/img/webp-source/photo.avif", "photo.avif"]
  ];

  for (const [rel, label] of checks) {
    if (await exists(resolve(root, rel))) pass("1", label, "created");
    else fail("1", label, "missing");
  }

  const webpSourceFiles = (await readdir(resolve(root, "src/img/webp-source"))).sort();
  if (webpSourceFiles.join(",") === "photo.avif,photo.webp") {
    pass("1", "webp source yields avif only");
  } else fail("1", "webp source yields avif only", webpSourceFiles.join(", "));

  if (/Initial pass complete: processed \d+, converted \d+, skipped \d+, failed \d+/.test(log)) {
    pass("1", "Summary line present");
  } else fail("1", "Summary line present");

  if (!log.includes("target already exists, skipping")) {
    pass("1", "No bulk skip noise");
  } else fail("1", "No bulk skip noise");

  await session.stop();
}

async function testSection2() {
  console.log("\n## 2. Idempotency");
  const session = await runVite(defaultConfigPath, {
    until: (log) => log.includes("Initial pass complete")
  });
  const log = session.log();
  const match = log.match(/Initial pass complete: processed \d+, converted (\d+), skipped (\d+), failed (\d+)/);

  if (match && Number(match[1]) === 0) pass("2", "Restart converted: 0");
  else fail("2", "Restart converted: 0", match?.[0] ?? "no summary");

  if (match && Number(match[2]) > 0) pass("2", "Skipped count > 0 on restart");
  else fail("2", "Skipped count > 0 on restart");

  await session.stop();
  await delay(1000);
}

async function testSection3(session) {
  console.log("\n## 3. Exclude");

  const excluded = [
    "src/img/excluded/should-not-convert.webp",
    "src/img/excluded/should-not-convert.avif",
    "public/img/excluded/public-excluded.webp",
    "public/img/excluded/public-excluded.avif"
  ];

  let allAbsent = true;
  for (const rel of excluded) {
    if (await exists(resolve(root, rel))) {
      allAbsent = false;
      fail("3", `No derivatives in exclude: ${rel}`, "file exists");
    }
  }
  if (allAbsent) pass("3", "Excluded src/public files not converted");

  await mkdir(resolve(root, "public/img/excluded/nested"), { recursive: true });
  await copyFile(
    resolve(root, "src/img/initial-pass/fresh.png"),
    resolve(root, "public/img/excluded/nested/deep.png")
  );
  await delay(1500);

  if (!(await exists(resolve(root, "public/img/excluded/nested/deep.webp")))) {
    pass("3", "Nested exclude not converted");
  } else fail("3", "Nested exclude not converted");
}

async function testSection4(session) {
  console.log("\n## 4. isGeneratedFile");

  await copyFile(
    resolve(root, "src/img/webp-source/photo.webp"),
    resolve(root, "src/img/live-add/standalone.webp")
  );
  await delay(2000);

  if (await exists(resolve(root, "src/img/live-add/standalone.avif"))) {
    pass("4", "Standalone webp -> avif");
  } else fail("4", "Standalone webp -> avif");

  const loopWebpMtime = (await stat(resolve(root, "src/img/generated-loop/loop.webp"))).mtimeMs;
  await delay(500);
  const loopWebpMtimeAfter = (await stat(resolve(root, "src/img/generated-loop/loop.webp"))).mtimeMs;
  if (Math.abs(loopWebpMtime - loopWebpMtimeAfter) < 5) {
    pass("4", "Generated loop.webp not reconverted");
  } else fail("4", "Generated loop.webp not reconverted");
}

async function testSection5() {
  console.log("\n## 5. Unsupported formats");

  if (!(await exists(resolve(root, "src/img/unsupported/ignore.gif.webp")))) {
    pass("5", "GIF ignored");
  } else fail("5", "GIF ignored");

  await writeFile(resolve(root, "src/img/unsupported/test.svg"), "<svg></svg>");
  await delay(1500);
  if (!(await exists(resolve(root, "src/img/unsupported/test.svg.webp")))) {
    pass("5", "SVG ignored");
  } else fail("5", "SVG ignored");
}

async function testSection6(session) {
  console.log("\n## 6. Live add");

  const target = resolve(root, "src/img/live-add/new-file.png");
  await copyFile(resolve(root, "src/img/initial-pass/fresh.png"), target);
  await delay(2500);

  if (await exists(resolve(root, "src/img/live-add/new-file.webp"))) {
    pass("6", "Live add creates webp");
  } else fail("6", "Live add creates webp");

  if (await exists(resolve(root, "src/img/live-add/new-file.avif"))) {
    pass("6", "Live add creates avif");
  } else fail("6", "Live add creates avif");

  const before = session.log();
  await copyFile(target, resolve(root, "src/img/live-add/new-file-copy.png"));
  await rm(target);
  await delay(100);
  await copyFile(resolve(root, "src/img/live-add/new-file-copy.png"), target);
  await delay(2500);
  const after = session.log().slice(before.length);

  if (after.includes("target already exists, skipping")) {
    pass("6", "Live skip log on existing target");
  } else fail("6", "Live skip log on existing target");
}

async function testSection7() {
  console.log("\n## 7. enableAvif: false");
  await removeDerivatives();
  const cfg = resolve(root, "scripts/.test-enableAvif-false.config.js");
  await writeFile(cfg, writeConfig({ enableAvif: false }));

  const session = await runVite(cfg, {
    until: (log) => log.includes("Initial pass complete") || log.includes("ready in")
  });
  await delay(3000);
  const log = session.log();

  if (log.includes("AVIF conversion: disabled")) pass("7", "AVIF disabled logged");
  else fail("7", "AVIF disabled logged");

  if (await exists(resolve(root, "src/img/initial-pass/fresh.webp"))) {
    pass("7", "WebP still created");
  } else fail("7", "WebP still created");

  const avifCount = (await readdir(resolve(root, "src/img/initial-pass"))).filter((f) =>
    f.endsWith(".avif")
  ).length;
  if (avifCount === 0) pass("7", "No avif files created");
  else fail("7", "No avif files created", `found ${avifCount}`);

  await session.stop();
  await rm(cfg, { force: true });
}

async function testSection8() {
  console.log("\n## 8. enableInitialPass: false");
  await removeDerivatives();
  const cfg = resolve(root, "scripts/.test-enableInitialPass-false.config.js");
  await writeFile(cfg, writeConfig({ enableInitialPass: false }));

  const session = await runVite(cfg, {
    until: (log) => log.includes("ready in")
  });
  await delay(2000);
  const log = session.log();

  if (!log.includes("Initial pass complete")) pass("8", "No initial pass summary");
  else fail("8", "No initial pass summary");

  if (!(await exists(resolve(root, "src/img/initial-pass/fresh.webp")))) {
    pass("8", "fresh.webp not created on start");
  } else fail("8", "fresh.webp not created on start");

  await copyFile(
    resolve(root, "src/img/initial-pass/fresh.png"),
    resolve(root, "src/img/live-add/initial-pass-off.png")
  );
  await delay(2500);

  if (await exists(resolve(root, "src/img/live-add/initial-pass-off.webp"))) {
    pass("8", "Live add works with initial pass off");
  } else fail("8", "Live add works with initial pass off");

  await session.stop();
  await rm(cfg, { force: true });
}

async function testSection9() {
  console.log("\n## 9. Production build");
  const beforeWebp = await exists(resolve(root, "src/img/initial-pass/fresh.webp"));
  const output = await new Promise((res, rej) => {
    const chunks = [];
    // Spawn the Vite binary directly (not via `npx`) so this works cross-platform;
    // on Windows `spawn("npx", ...)` without a shell fails with ENOENT.
    const child = spawn(process.execPath, [viteBinPath, "build", "--config", defaultConfigPath], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.on("error", rej);
    child.stdout.on("data", (c) => chunks.push(c.toString()));
    child.stderr.on("data", (c) => chunks.push(c.toString()));
    child.on("exit", (code) => (code === 0 ? res(chunks.join("")) : rej(new Error(chunks.join("")))));
  });

  if (!output.includes("[vite-webp-avif-generator]")) pass("9", "No converter logs in build");
  else fail("9", "No converter logs in build");

  const afterWebp = await exists(resolve(root, "src/img/initial-pass/fresh.webp"));
  if (beforeWebp === afterWebp) pass("9", "Build did not create new derivatives");
  else fail("9", "Build did not create new derivatives");
}

async function testSection10() {
  console.log("\n## 10. Missing watched folder");
  const cfg = resolve(root, "scripts/.test-missing-folder.config.js");
  await writeFile(
    cfg,
    writeConfig({ folders: ["src/img", "public/img", "src/img/missing-folder"] })
  );

  let ok = false;
  try {
    const session = await runVite(cfg, {
      until: (log) => log.includes("Initial pass complete"),
      timeoutMs: 45000
    });
    ok = true;
    pass("10", "Server starts with missing folder");
    if (session.log().includes("Initial pass complete")) {
      pass("10", "Initial pass completes for other folders");
    } else fail("10", "Initial pass completes for other folders");
    await session.stop();
  } catch (error) {
    fail("10", "Server starts with missing folder", error.message);
  }
  await rm(cfg, { force: true });
  if (!ok) return;
}

async function testSection11() {
  console.log("\n## 11. Symlinks");
  await resetFixtures();
  await removeDerivatives();

  const symlinkFile = resolve(root, "src/img/symlink-test.png");
  const symlinkDir = resolve(root, "src/img/symlink-dir");
  await rm(symlinkFile, { force: true });
  await rm(symlinkDir, { recursive: true, force: true });

  const symlinkOutside = resolve(root, "symlink-outside");
  await rm(symlinkOutside, { recursive: true, force: true });
  await mkdir(symlinkOutside, { recursive: true });
  await copyFile(
    resolve(root, "src/img/initial-pass/fresh.png"),
    resolve(symlinkOutside, "island-only.png")
  );

  const { symlink } = await import("fs/promises");
  try {
    await symlink("../initial-pass/fresh.png", symlinkFile);
    await symlink("../../symlink-outside", symlinkDir);
  } catch (error) {
    // Creating symlinks on Windows needs elevation/Developer Mode; skip cleanly there.
    if (error.code === "EPERM" || error.code === "EACCES") {
      console.log(`  - Skipped (no symlink privilege): ${error.code}`);
      await rm(symlinkOutside, { recursive: true, force: true });
      return;
    }
    throw error;
  }

  const session = await runVite(defaultConfigPath, {
    until: (log) => log.includes("Initial pass complete")
  });

  if (!(await exists(resolve(root, "src/img/symlink-test.webp")))) {
    pass("11", "Symlink file not followed");
  } else fail("11", "Symlink file not followed");

  if (!(await exists(resolve(symlinkOutside, "island-only.webp")))) {
    pass("11", "Symlink directory not recursed");
  } else fail("11", "Symlink directory not recursed");

  await session.stop();
  await rm(symlinkFile, { force: true });
  await rm(symlinkDir, { recursive: true, force: true });
  await rm(symlinkOutside, { recursive: true, force: true });
}

async function testSection12() {
  console.log("\n## 12. Atomic write / interrupt");
  await resetFixtures();
  await removeDerivatives();
  await rm(resolve(root, "src/img/initial-pass/fresh.webp"), { force: true });

  const child = spawn(process.execPath, [viteBinPath, "--config", defaultConfigPath], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
  await delay(400);
  child.kill("SIGKILL");
  await new Promise((resolveExit) => child.once("exit", resolveExit));

  const webpPath = resolve(root, "src/img/initial-pass/fresh.webp");
  const tmpFiles = (await readdir(resolve(root, "src/img/initial-pass"))).filter((f) =>
    f.includes(".tmp")
  );

  if (tmpFiles.length === 0) pass("12", "No leftover temp files");
  else fail("12", "No leftover temp files", tmpFiles.join(", "));

  try {
    if (!(await exists(webpPath))) {
      pass("12", "No partial webp after kill");
    } else {
      const size = (await stat(webpPath)).size;
      if (size > 100) pass("12", "webp complete after kill race", `${size} bytes`);
      else fail("12", "webp looks truncated", `${size} bytes`);
    }
  } finally {
    // SIGKILL cannot run plugin cleanup and may interrupt unrelated parallel
    // fixture conversions. Remove their private temp outputs so the test suite
    // itself does not leave the working tree dirty.
    await removeTemporaryOutputs();
  }
}

async function testSection13() {
  console.log("\n## 13. Watcher stop");
  // Vite only registers a graceful-shutdown listener for SIGTERM, which on Windows
  // is not deliverable to a handler (the process is terminated unconditionally), so
  // the cleanup path can't be exercised via a spawned signal there. The same guarantee
  // is verified cross-platform in test-nuxt-watcher-cleanup.mjs via in-process close().
  if (process.platform === "win32") {
    console.log("  - Skipped on Windows (SIGTERM cleanup covered by test-nuxt-watcher-cleanup.mjs)");
    return;
  }
  const session = await runVite(defaultConfigPath, {
    until: (log) => log.includes("ready in")
  });
  await delay(1000);
  await session.stop();
  await delay(3000);
  const log = session.log();
  if (log.includes("[vite-webp-avif-generator] File watcher stopped")) {
    pass("13", "Watcher stopped on shutdown");
  } else fail("13", "Watcher stopped on shutdown");
}

async function testSection14(session) {
  console.log("\n## 14. Extra edge cases");

  await mkdir(resolve(root, "src/img/empty"), { recursive: true });
  await writeFile(resolve(root, "src/img/unsupported/corrupt.png"), "not an image");
  await delay(2000);

  const log = session?.log?.() ?? "";
  if (log.includes("conversion failed") || log.includes("Error while processing")) {
    pass("14", "Corrupt file logged, server alive");
  } else {
    const session2 = await runVite(defaultConfigPath, {
      until: (l) => l.includes("ready in")
    });
    await writeFile(resolve(root, "src/img/unsupported/corrupt2.png"), "not an image");
    await delay(2000);
    if (session2.log().includes("conversion failed")) {
      pass("14", "Corrupt file logged, server alive");
    } else fail("14", "Corrupt file logged, server alive");
    await session2.stop();
  }

  await copyFile(
    resolve(root, "public/img/initial-pass/public-fresh.jpg"),
    resolve(root, "src/img/live-add/Test.JPG")
  );
  await delay(2500);
  if (await exists(resolve(root, "src/img/live-add/Test.webp"))) {
    pass("14", "Uppercase JPG extension handled");
  } else fail("14", "Uppercase JPG extension handled");
}

async function main() {
  console.log("Running TEST-CASES.md checks...\n");
  await killPort5173();
  await resetFixtures();
  await removeDerivatives();

  await testSection1();
  await testSection2();

  const liveSession = await runVite(defaultConfigPath, {
    until: (log) => log.includes("Initial pass complete")
  });

  await testSection3(liveSession);
  await testSection4(liveSession);
  await testSection5();
  await testSection6(liveSession);
  await testSection14(liveSession);
  await liveSession.stop();

  await testSection7();
  await testSection8();
  await testSection9();
  await testSection10();
  await testSection11();
  await testSection12();
  await testSection13();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log(`\n========================================`);
  console.log(`Results: ${passed}/${results.length} passed`);
  if (failed.length) {
    console.log("\nFailed:");
    for (const item of failed) {
      console.log(`  [${item.section}] ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
