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
const scratchRoot = resolve(playgroundRoot, ".output-naming-scratch");

const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`  ${condition ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitFor(predicate, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return true;
    await delay(intervalMs);
  }
  return false;
}

async function writeFixture(path, format, background) {
  await mkdir(dirname(path), { recursive: true });
  await sharp({
    create: { width: 24, height: 24, channels: 3, background }
  })
    [format]({ quality: 90 })
    .toFile(path);
}

async function startCase(caseName, pluginOptions = {}) {
  const caseRoot = resolve(scratchRoot, caseName);
  const capture = createCaptureLogger();
  const server = await createServer({
    root: caseRoot,
    publicDir: resolve(caseRoot, "public"),
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

  const completed = await waitFor(() => capture.text().includes("Initial pass complete"));
  await server.close();
  check(`${caseName}: initial pass completed`, completed);
  return { caseRoot, capture };
}

async function testDefaultReplaceMode() {
  console.log("\n## Default replace mode");
  const caseRoot = resolve(scratchRoot, "replace");
  const imageDir = resolve(caseRoot, "public/img");
  await writeFixture(resolve(imageDir, "logo.png"), "png", { r: 240, g: 20, b: 20 });
  await writeFixture(resolve(imageDir, "logo.jpg"), "jpeg", { r: 20, g: 20, b: 240 });

  const { capture } = await startCase("replace");
  const collisionWarnings = capture.count("multiple sources map to the same output");

  check("replace: legacy WebP target exists", existsSync(resolve(imageDir, "logo.webp")));
  check("replace: legacy AVIF target exists", existsSync(resolve(imageDir, "logo.avif")));
  check(
    "replace: target collision is reported once per affected target",
    collisionWarnings === 2,
    `count=${collisionWarnings}`
  );
  check(
    "replace: warning recommends preserve mode",
    capture.text().includes('outputNaming: "preserve"')
  );
}

async function testPreserveMode() {
  console.log("\n## Preserve mode");
  const caseRoot = resolve(scratchRoot, "preserve");
  const imageDir = resolve(caseRoot, "public/img");
  await writeFixture(resolve(imageDir, "logo.png"), "png", { r: 240, g: 20, b: 20 });
  await writeFixture(resolve(imageDir, "logo.jpg"), "jpeg", { r: 20, g: 20, b: 240 });

  const { capture } = await startCase("preserve", { outputNaming: "preserve" });
  const expectedTargets = [
    "logo.png.webp",
    "logo.png.avif",
    "logo.jpg.webp",
    "logo.jpg.avif"
  ];

  for (const target of expectedTargets) {
    check(`preserve: ${target} exists`, existsSync(resolve(imageDir, target)));
  }
  check("preserve: shared WebP target is absent", !existsSync(resolve(imageDir, "logo.webp")));
  check("preserve: shared AVIF target is absent", !existsSync(resolve(imageDir, "logo.avif")));
  check(
    "preserve: no collision warning",
    !capture.text().includes("multiple sources map to the same output")
  );
}

async function testDuplicateFolders() {
  console.log("\n## Duplicate watched folders");
  const caseRoot = resolve(scratchRoot, "duplicate-folders");
  const imageDir = resolve(caseRoot, "public/img");
  await writeFixture(resolve(imageDir, "single.png"), "png", { r: 20, g: 180, b: 80 });

  const { capture } = await startCase("duplicate-folders", {
    folders: ["public/img", "public/img"]
  });

  check(
    "duplicate folders: physical source is processed once",
    capture.text().includes("Initial pass complete: processed 1, converted 2, skipped 0, failed 0"),
    capture.messages.find((message) => message.includes("Initial pass complete")) ?? "summary missing"
  );
}

async function main() {
  console.log("Running output naming checks...");
  await rm(scratchRoot, { recursive: true, force: true });

  try {
    await testDefaultReplaceMode();
    await testPreserveMode();
    await testDuplicateFolders();
  } finally {
    await rm(scratchRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
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
