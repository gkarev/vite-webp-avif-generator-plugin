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
