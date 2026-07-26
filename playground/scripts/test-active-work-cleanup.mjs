import { randomBytes } from "crypto";
import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { dirname, resolve } from "path";
import { setTimeout as delay } from "timers/promises";
import { fileURLToPath } from "url";
import { createServer } from "vite";
import sharp from "sharp";
import convertImages from "../../vite-webp-avif-generator-plugin.js";
import { createCaptureLogger } from "./capture-logger.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const playgroundRoot = resolve(__dirname, "..");
const scratchRoot = resolve(playgroundRoot, ".active-work-scratch");
const imageDir = resolve(scratchRoot, "public/img");
const sourcePath = resolve(imageDir, "detailed.png");
const webpPath = resolve(imageDir, "detailed.webp");
const avifPath = resolve(imageDir, "detailed.avif");

const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`  ${condition ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitFor(predicate, { timeoutMs = 60000, intervalMs = 10 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return true;
    await delay(intervalMs);
  }
  return false;
}

async function createDetailedFixture() {
  const width = 900;
  const height = 900;
  await mkdir(imageDir, { recursive: true });
  await sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 }
  })
    .png({ compressionLevel: 1 })
    .toFile(sourcePath);
}

async function main() {
  console.log("Running active-work cleanup checks...");
  await rm(scratchRoot, { recursive: true, force: true });
  await createDetailedFixture();

  const capture = createCaptureLogger();
  let server;

  try {
    server = await createServer({
      root: scratchRoot,
      publicDir: resolve(scratchRoot, "public"),
      configFile: false,
      customLogger: capture.logger,
      server: { middlewareMode: true },
      plugins: [
        convertImages({
          folders: ["public/img"],
          enableInitialPass: true,
          avifOptions: { effort: 9 }
        })
      ]
    });

    const conversionStarted = await waitFor(() => capture.text().includes("New file detected"));
    check("initial-pass conversion started", conversionStarted);

    const closeStartedAt = Date.now();
    await server.close();
    const closeElapsedMs = Date.now() - closeStartedAt;
    server = undefined;

    check("server.close waits for WebP output", existsSync(webpPath), `close=${closeElapsedMs}ms`);
    check("server.close waits for AVIF output", existsSync(avifPath), `close=${closeElapsedMs}ms`);
    check(
      "server.close waits for initial-pass summary",
      capture.text().includes("Initial pass complete: processed 1, converted 2, skipped 0, failed 0"),
      `close=${closeElapsedMs}ms`
    );
  } finally {
    if (server) await server.close();
    await waitFor(() => capture.text().includes("Initial pass complete"));
    await rm(scratchRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200
    });
  }

  const passed = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);

  console.log("\n========================================");
  console.log(`Results: ${passed}/${results.length} passed`);
  if (failed.length > 0) {
    console.log("\nFailed:");
    for (const result of failed) {
      console.log(`  - ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exitCode = 1;
});
