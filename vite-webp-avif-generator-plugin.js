import { resolve, dirname, extname, basename, relative, isAbsolute } from "path";
import { existsSync } from "fs";
import { readdir, rename, rm } from "fs/promises";
import { cpus } from "os";
import { randomBytes } from "crypto";
import { normalizePath } from "vite";
import sharp from "sharp";
import chokidar from "chokidar";

const MIN_BULK_CONCURRENCY = 4;

/**
 * @typedef {Object} PluginConfig
 * @property {string[]} [folders=['src/img', 'public/img']] - Folders to watch
 * @property {string[]} [exclude=[]] - Folders to exclude
 * @property {boolean} [enableAvif=true] - Enable AVIF conversion
 * @property {boolean} [enableInitialPass=true] - Run a one-time conversion pass for existing files on server start
 */

/**
 * Vite plugin for automatic WebP and AVIF generation in dev mode.
 * @param {PluginConfig} [config={}] - Plugin configuration
 * @returns {import('vite').Plugin}
 */
export default function convertImages(config = {}) {
  const {
    folders = ["src/img", "public/img"],
    exclude = [],
    enableAvif = true,
    enableInitialPass = true
  } = config;

  const SUPPORTED_FORMATS = [".jpg", ".jpeg", ".png", ".webp"];

  let rootDir = process.cwd();
  let publicDir = "";

  return {
    name: "vite-webp-avif-generator",
    apply: "serve",

    /**
     * @param {import('vite').ResolvedConfig} resolvedConfig
     */
    configResolved(resolvedConfig) {
      rootDir = resolvedConfig.root || process.cwd();
      publicDir =
        typeof resolvedConfig.publicDir === "string" ? resolvedConfig.publicDir : "";
    },

    /**
     * @param {import('vite').ViteDevServer} server
     */
    configureServer(server) {
      const watchPaths = folders.map((folder) =>
        resolveConfiguredPath(folder, rootDir, publicDir)
      );
      const resolvedExclude = exclude.map((folder) =>
        resolveConfiguredPath(folder, rootDir, publicDir)
      );

      console.log("\n[Image Converter] Starting file watcher...");
      console.log(`[Image Converter] Watched folders: ${folders.join(", ")}`);
      if (exclude.length > 0) {
        console.log(`[Image Converter] Excluded folders: ${exclude.join(", ")}`);
      }
      console.log(
        `[Image Converter] AVIF conversion: ${enableAvif ? "enabled" : "disabled"}\n`
      );

      const watcher = chokidar.watch(watchPaths, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        }
      });

      watcher.on("add", async (filePath) => {
        await handleFileAdd(filePath, {
          rootDir,
          publicDir,
          exclude: resolvedExclude,
          enableAvif,
          SUPPORTED_FORMATS
        });
      });

      watcher.on("error", (error) => {
        console.error("[Image Converter] File watcher error:", error);
      });

      if (enableInitialPass) {
        watcher.once("ready", () => {
          void runInitialPass(watchPaths, {
            rootDir,
            publicDir,
            exclude: resolvedExclude,
            enableAvif,
            SUPPORTED_FORMATS
          });
        });
      }

      let watcherClosed = false;
      const closeWatcher = async () => {
        if (watcherClosed) {
          return;
        }

        watcherClosed = true;
        await watcher.close();
        console.log("\n[Image Converter] File watcher stopped");
      };

      if (server.httpServer) {
        server.httpServer.once("close", () => {
          void closeWatcher();
        });
      }
    }
  };
}

/**
 * Handle a newly added file.
 * @param {string} filePath - Added file path
 * @param {Object} options - Handler options
 * @param {string} options.rootDir - Resolved Vite root
 * @param {string} options.publicDir - Resolved Vite publicDir
 * @param {string[]} options.exclude - Absolute excluded folders
 * @param {boolean} options.enableAvif - Enable AVIF generation
 * @param {string[]} options.SUPPORTED_FORMATS - Supported source formats
 * @param {boolean} [options.isBulk=false] - Suppress per-file "already exists" logs during the initial pass
 * @returns {Promise<{converted: number, skipped: number, failed: number}>}
 */
async function handleFileAdd(filePath, options) {
  const { rootDir, publicDir, exclude, enableAvif, SUPPORTED_FORMATS, isBulk = false } = options;
  const tally = { converted: 0, skipped: 0, failed: 0 };

  try {
    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_FORMATS.includes(ext)) {
      return tally;
    }

    if (isInExcludedFolder(filePath, exclude)) {
      return tally;
    }

    if (isGeneratedFile(filePath)) {
      return tally;
    }

    console.log(
      `\n[Image Converter] New file detected: ${getDisplayPath(filePath, rootDir, publicDir)}`
    );

    const conversions = [];
    const isWebP = ext === ".webp";

    if (!isWebP) {
      conversions.push({
        format: "webp",
        targetPath: getTargetPath(filePath, "webp")
      });
    }

    if (enableAvif) {
      conversions.push({
        format: "avif",
        targetPath: getTargetPath(filePath, "avif")
      });
    }

    const results = await Promise.allSettled(
      conversions.map(({ format, targetPath }) =>
        convertImage(filePath, targetPath, format, { quiet: isBulk })
      )
    );

    const successful = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.filter((result) => result.status === "rejected").length;

    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value === "converted") {
          tally.converted += 1;
        } else {
          tally.skipped += 1;
        }
      } else {
        tally.failed += 1;
      }
    }

    if (successful > 0) {
      console.log(`[Image Converter] Successfully converted: ${successful} format(s)`);
    }
    if (failed > 0) {
      console.log(`[Image Converter] Conversion errors: ${failed}`);
    }
  } catch (error) {
    tally.failed += 1;
    console.error(
      `[Image Converter] Error while processing ${filePath}:`,
      error.message
    );
  }

  return tally;
}

/**
 * Convert an image to the requested format using an atomic write (temp file + rename).
 * @param {string} sourcePath - Source image path
 * @param {string} targetPath - Target image path
 * @param {string} format - Target format (webp/avif)
 * @param {Object} [options={}] - Conversion options
 * @param {boolean} [options.quiet=false] - Suppress the "target already exists" log line
 * @returns {Promise<"converted"|"skipped">}
 */
async function convertImage(sourcePath, targetPath, format, { quiet = false } = {}) {
  if (existsSync(targetPath)) {
    if (!quiet) {
      console.log(`   ${format.toUpperCase()}: target already exists, skipping`);
    }
    return "skipped";
  }

  const tempPath = `${targetPath}.${randomBytes(4).toString("hex")}.tmp`;
  const startTime = Date.now();

  try {
    await sharp(sourcePath)[format]().toFile(tempPath);
    await rename(tempPath, targetPath);

    const duration = Date.now() - startTime;
    console.log(`   ${format.toUpperCase()}: converted in ${duration}ms`);
    return "converted";
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    console.error(`   ${format.toUpperCase()}: conversion failed - ${error.message}`);
    throw error;
  }
}

/**
 * Resolve a configured folder against Vite root or publicDir.
 * This keeps `public/...` working when frameworks set `root` to `srcDir`.
 * @param {string} configuredPath - Path from plugin config
 * @param {string} rootDir - Resolved Vite root
 * @param {string} publicDir - Resolved Vite publicDir
 * @returns {string}
 */
function resolveConfiguredPath(configuredPath, rootDir, publicDir) {
  if (isAbsolute(configuredPath)) {
    return configuredPath;
  }

  const normalizedConfiguredPath = trimSlashes(normalizePath(configuredPath));

  if (!normalizedConfiguredPath) {
    return rootDir;
  }

  if (publicDir) {
    const publicDirName = basename(trimSlashes(normalizePath(publicDir)));

    if (
      normalizedConfiguredPath === publicDirName ||
      normalizedConfiguredPath.startsWith(`${publicDirName}/`)
    ) {
      return resolve(dirname(publicDir), configuredPath);
    }
  }

  return resolve(rootDir, configuredPath);
}

/**
 * Normalize a path for safe folder comparisons across platforms.
 * @param {string} path - Path to normalize
 * @returns {string}
 */
function normalizeComparisonPath(path) {
  const normalizedPath = normalizePath(path).replace(/\/+$/, "");
  return process.platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
}

/**
 * Trim leading and trailing slashes.
 * @param {string} value - Raw value
 * @returns {string}
 */
function trimSlashes(value) {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Check whether a file is inside an excluded folder.
 * @param {string} filePath - File path
 * @param {string[]} exclude - Absolute excluded folders
 * @returns {boolean}
 */
function isInExcludedFolder(filePath, exclude) {
  if (exclude.length === 0) return false;

  const normalizedFilePath = normalizeComparisonPath(filePath);

  return exclude.some((excludePath) => {
    const normalizedExclude = normalizeComparisonPath(excludePath);

    return (
      normalizedFilePath === normalizedExclude ||
      normalizedFilePath.startsWith(`${normalizedExclude}/`)
    );
  });
}

/**
 * Detect generated WebP/AVIF files to avoid loops.
 * @param {string} filePath - File path
 * @returns {boolean}
 */
function isGeneratedFile(filePath) {
  const ext = extname(filePath).toLowerCase();

  if (![".avif", ".webp"].includes(ext)) {
    return false;
  }

  const fileNameWithoutExt = basename(filePath, ext);
  const dirPath = dirname(filePath);
  const possibleOriginals = [".jpg", ".jpeg", ".png"];

  return possibleOriginals.some((originalExt) => {
    const originalPath = resolve(dirPath, fileNameWithoutExt + originalExt);
    return existsSync(originalPath);
  });
}

/**
 * Build a target path for the requested output format.
 * @param {string} sourcePath - Source image path
 * @param {string} format - Target format
 * @returns {string}
 */
function getTargetPath(sourcePath, format) {
  const dir = dirname(sourcePath);
  const ext = extname(sourcePath);
  const name = basename(sourcePath, ext);
  return resolve(dir, `${name}.${format}`);
}

/**
 * Return a readable path for logs.
 * @param {string} filePath - Absolute file path
 * @param {string} rootDir - Resolved Vite root
 * @param {string} publicDir - Resolved Vite publicDir
 * @returns {string}
 */
function getDisplayPath(filePath, rootDir, publicDir) {
  const normalizedFilePath = normalizeComparisonPath(filePath);
  const normalizedRootDir = normalizeComparisonPath(rootDir);

  if (
    normalizedFilePath === normalizedRootDir ||
    normalizedFilePath.startsWith(`${normalizedRootDir}/`)
  ) {
    return normalizePath(relative(rootDir, filePath));
  }

  if (publicDir) {
    const normalizedPublicDir = normalizeComparisonPath(publicDir);

    if (
      normalizedFilePath === normalizedPublicDir ||
      normalizedFilePath.startsWith(`${normalizedPublicDir}/`)
    ) {
      return normalizePath(relative(dirname(publicDir), filePath));
    }
  }

  return normalizePath(filePath);
}

/**
 * Recursively list files in a directory without following symlinks.
 * @param {string} dirPath - Directory to scan
 * @returns {Promise<string[]>}
 */
async function listFilesRecursively(dirPath) {
  const files = [];
  let entries;

  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    console.error(`[Image Converter] Failed to read directory ${dirPath}: ${error.message}`);
    return files;
  }

  for (const entry of entries) {
    const entryPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

/**
 * Run async work over a list of items with a maximum concurrency.
 * @param {Array} items - Items to process
 * @param {number} limit - Maximum concurrent workers
 * @param {(item: *) => Promise<void>} worker - Async worker function
 * @returns {Promise<void>}
 */
async function runWithConcurrencyLimit(items, limit, worker) {
  let cursor = 0;

  async function runNext() {
    const index = cursor++;
    if (index >= items.length) {
      return;
    }
    await worker(items[index]);
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
}

/**
 * Run a one-time idempotent conversion pass for files already present in watched folders.
 * @param {string[]} watchPaths - Absolute watched folder paths
 * @param {Object} handlerOptions - Options forwarded to handleFileAdd
 * @returns {Promise<void>}
 */
async function runInitialPass(watchPaths, handlerOptions) {
  const filesByFolder = await Promise.all(
    watchPaths.map((folder) => (existsSync(folder) ? listFilesRecursively(folder) : []))
  );
  const files = filesByFolder.flat();

  const summary = { processed: files.length, converted: 0, skipped: 0, failed: 0 };
  const concurrency = Math.max(MIN_BULK_CONCURRENCY, cpus().length);

  await runWithConcurrencyLimit(files, concurrency, async (filePath) => {
    const result = await handleFileAdd(filePath, { ...handlerOptions, isBulk: true });
    summary.converted += result.converted;
    summary.skipped += result.skipped;
    summary.failed += result.failed;
  });

  console.log(
    `[Image Converter] Initial pass complete: processed ${summary.processed}, converted ${summary.converted}, skipped ${summary.skipped}, failed ${summary.failed}`
  );
}
