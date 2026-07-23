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

async function resetCaseDir(caseDir) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(caseDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error.code !== "EBUSY" || attempt === 4) {
        throw error;
      }
      await delay(200);
    }
  }
}

async function runInitialCase(name, pluginOptions, prepareTarget) {
  const caseDir = resolve(scratchRoot, name);
  const sourcePath = resolve(caseDir, "public/img/sample.png");
  const webpPath = resolve(caseDir, "public/img/sample.webp");
  const avifPath = resolve(caseDir, "public/img/sample.avif");

  await resetCaseDir(caseDir);
  await createDetailedPng(sourcePath);
  if (prepareTarget) await prepareTarget({ sourcePath, webpPath, avifPath });

  const capture = createCaptureLogger();
  const server = await startServer(caseDir, pluginOptions, capture);
  try {
    await waitForInitialPass(capture);
  } finally {
    await server.close();
    await delay(300);
  }

  return { caseDir, sourcePath, webpPath, avifPath, capture };
}

async function runLiveCase(name, pluginOptions) {
  const caseDir = resolve(scratchRoot, name);
  const sourcePath = resolve(caseDir, "public/img/live.png");
  const webpPath = resolve(caseDir, "public/img/live.webp");
  const avifPath = resolve(caseDir, "public/img/live.avif");

  await resetCaseDir(caseDir);
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
    await delay(300);
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

async function testWebpSourceUsesAvifOptionsOnly() {
  console.log("\n## WebP source uses avifOptions only");
  const caseDir = resolve(scratchRoot, "webp-source-avif-only");
  const sourcePath = resolve(caseDir, "public/img/sample.webp");
  const avifPath = resolve(caseDir, "public/img/sample.avif");
  const webpOptions = { quality: 1 };
  const avifOptions = { quality: 52, effort: 0, chromaSubsampling: "4:2:0" };

  await resetCaseDir(caseDir);
  const seedPng = resolve(caseDir, "public/img/_seed.png");
  await createDetailedPng(seedPng);
  const sourceWebp = await encodeDirect(seedPng, "webp", { quality: 88, effort: 4 });
  await writeFile(sourcePath, sourceWebp);

  const capture = createCaptureLogger();
  const server = await startServer(caseDir, { webpOptions, avifOptions }, capture);
  try {
    await waitForInitialPass(capture);
  } finally {
    await server.close();
    await delay(300);
  }

  const actualSource = await readFile(sourcePath);
  const actualAvif = await readFile(avifPath);
  const expectedAvif = await encodeDirect(actualSource, "avif", avifOptions);

  check("WebP source bytes are unchanged", actualSource.equals(sourceWebp));
  check("AVIF sibling is created", existsSync(avifPath));
  check("AVIF equals direct Sharp output with avifOptions", actualAvif.equals(expectedAvif));
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

  try {
    await testInitialPassNativeOptions();
    await testLiveNativeOptions();
    await testOmittedOptions();
    await testExistingTargetIsUntouched();
    await testWebpSourceUsesAvifOptionsOnly();
    await testInvalidNativeValue();
  } finally {
    // Drop libvips' file cache before removing Windows fixtures. All plugin
    // servers are closed at this point, so no conversion can still use it.
    sharp.cache(false);
    await rm(scratchRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200
    });
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
