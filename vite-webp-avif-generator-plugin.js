import { resolve, dirname, extname, basename, relative, isAbsolute } from "path";
import { existsSync } from "fs";
import { lstat, readdir, rename, rm } from "fs/promises";
import { cpus } from "os";
import { randomBytes } from "crypto";
import { normalizePath } from "vite";
import sharp from "sharp";
import chokidar from "chokidar";

const MIN_BULK_CONCURRENCY = 4;
const LOG_LABEL = "[vite-webp-avif-generator]";
const INCOMPLETE_FILE_TTL_MS = 24 * 60 * 60 * 1000;
const INCOMPLETE_FILE_PATTERN =
  /^.+\.vite-webp-avif-generator\.[0-9a-f]{16}\.incomplete$/;

/**
 * @typedef {Object} PluginConfig
 * @property {string[]} [folders=['src/img', 'public/img']] - Folders to watch
 * @property {string[]} [exclude=[]] - Folders to exclude
 * @property {boolean} [enableAvif=true] - Enable AVIF conversion
 * @property {boolean} [enableInitialPass=true] - Run a one-time conversion pass for existing files on server start
 * @property {"replace"|"preserve"} [outputNaming="replace"] - Output filename strategy
 * @property {import("sharp").WebpOptions} [webpOptions] - Native options passed unchanged to `sharp().webp()`
 * @property {import("sharp").AvifOptions} [avifOptions] - Native options passed unchanged to `sharp().avif()`
 * @property {string} [publicDir] - Explicit public directory used to resolve `public/...`-style
 *   `folders`/`exclude` entries. Overrides Vite's own `publicDir` detection, which is required
 *   for Nuxt (Vite's `publicDir` is always `false` there, regardless of `srcDir`).
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
    enableInitialPass = true,
    outputNaming: configuredOutputNaming = "replace",
    publicDir: publicDirOption,
    webpOptions,
    avifOptions
  } = config;

  const outputNaming = configuredOutputNaming === "preserve" ? "preserve" : "replace";

  const formatOptions = {
    webp: webpOptions,
    avif: avifOptions
  };

  const SUPPORTED_FORMATS = [".jpg", ".jpeg", ".png", ".webp"];

  let rootDir = process.cwd();
  let publicDir = "";
  /** @type {import('vite').Logger} */
  let logger = console;

  return {
    name: "vite-webp-avif-generator",
    apply: "serve",

    /**
     * @param {import('vite').ResolvedConfig} resolvedConfig
     */
    configResolved(resolvedConfig) {
      rootDir = resolvedConfig.root || process.cwd();
      publicDir = resolveEffectivePublicDir(publicDirOption, resolvedConfig.publicDir, rootDir);
      logger = resolvedConfig.logger;
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
      const handlerOptions = {
        rootDir,
        publicDir,
        exclude: resolvedExclude,
        enableAvif,
        outputNaming,
        SUPPORTED_FORMATS,
        formatOptions,
        logger
      };
      const activeTasks = new Set();
      const activeFileTasks = new Map();

      const trackTask = (task) => {
        activeTasks.add(task);
        task.then(
          () => activeTasks.delete(task),
          () => activeTasks.delete(task)
        );
        return task;
      };

      const processFileOnce = (filePath, overrides = {}) => {
        const fileKey = normalizeComparisonPath(filePath);
        const activeTask = activeFileTasks.get(fileKey);
        if (activeTask) return activeTask;

        const task = handleFileAdd(filePath, { ...handlerOptions, ...overrides }).finally(() => {
          activeFileTasks.delete(fileKey);
        });
        activeFileTasks.set(fileKey, task);
        return trackTask(task);
      };

      logger.info(`\n${LOG_LABEL} Starting file watcher...`);
      logger.info(`${LOG_LABEL} Watched folders: ${folders.join(", ")}`);
      logger.info(describeResolvedFolders(folders, watchPaths));
      if (exclude.length > 0) {
        logger.info(`${LOG_LABEL} Excluded folders: ${exclude.join(", ")}`);
        logger.info(describeResolvedFolders(exclude, resolvedExclude));
      }
      logger.info(`${LOG_LABEL} AVIF conversion: ${enableAvif ? "enabled" : "disabled"}\n`);
      warnAboutMissingFolders(folders, watchPaths, logger);

      const watcher = chokidar.watch(watchPaths, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        }
      });

      watcher.on("add", (filePath) => {
        void processFileOnce(filePath);
      });

      watcher.on("error", (error) => {
        logger.error(`${LOG_LABEL} File watcher error: ${error?.message ?? error}`);
      });

      watcher.once("ready", () => {
        const startupTask = (async () => {
          await cleanupStaleIncompleteFiles(watchPaths, resolvedExclude, logger);
          if (enableInitialPass) {
            await runInitialPass(
              watchPaths,
              handlerOptions,
              (filePath, overrides) => processFileOnce(filePath, overrides)
            );
          }
        })();

        void trackTask(startupTask).catch((error) => {
          logger.error(`${LOG_LABEL} Startup processing failed: ${error.message}`);
        });
      });

      // Close this watcher when *this specific* dev server instance shuts
      // down, by wrapping its own `close()` rather than relying on
      // `server.httpServer` (which is `null` in middleware mode, e.g. Nuxt)
      // or a factory-scoped variable. Frameworks like Nuxt run a separate
      // Vite server per environment (client/server) from the same plugin
      // object, so state must stay local to each `server` instance to avoid
      // one watcher's cleanup overwriting another's.
      let cleanupPromise;
      const originalClose = server.close.bind(server);
      const cleanup = () => {
        if (!cleanupPromise) {
          cleanupPromise = (async () => {
            let watcherClosed = false;
            try {
              await watcher.close();
              watcherClosed = true;
            } catch (error) {
              logger.error(`${LOG_LABEL} Failed to close file watcher: ${error.message}`);
            }

            await Promise.allSettled([...activeTasks]);
            if (watcherClosed) {
              logger.info(`\n${LOG_LABEL} File watcher stopped`);
            }
          })();
        }
        return cleanupPromise;
      };

      server.close = async (...args) => {
        await cleanup();
        return originalClose(...args);
      };
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
 * @param {"replace"|"preserve"} options.outputNaming - Output filename strategy
 * @param {string[]} options.SUPPORTED_FORMATS - Supported source formats
 * @param {{webp: import("sharp").WebpOptions|undefined, avif: import("sharp").AvifOptions|undefined}} options.formatOptions - Native Sharp options by target format
 * @param {import('vite').Logger} options.logger - Vite logger
 * @param {boolean} [options.isBulk=false] - Suppress per-file "already exists" logs during the initial pass
 * @returns {Promise<{converted: number, skipped: number, failed: number}>}
 */
async function handleFileAdd(filePath, options) {
  const {
    rootDir,
    publicDir,
    exclude,
    enableAvif,
    outputNaming,
    SUPPORTED_FORMATS,
    formatOptions,
    logger,
    isBulk = false
  } = options;
  const tally = { converted: 0, skipped: 0, failed: 0 };

  try {
    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_FORMATS.includes(ext)) {
      return tally;
    }

    if (isInExcludedFolder(filePath, exclude)) {
      return tally;
    }

    if (isGeneratedFile(filePath, outputNaming)) {
      return tally;
    }

    logger.info(
      `\n${LOG_LABEL} New file detected: ${getDisplayPath(filePath, rootDir, publicDir)}`
    );

    const conversions = [];
    const isWebP = ext === ".webp";

    if (!isWebP) {
      conversions.push({
        format: "webp",
        targetPath: getTargetPath(filePath, "webp", outputNaming)
      });
    }

    if (enableAvif) {
      conversions.push({
        format: "avif",
        targetPath: getTargetPath(filePath, "avif", outputNaming)
      });
    }

    const results = await Promise.allSettled(
      conversions.map(({ format, targetPath }) =>
        convertImage(filePath, targetPath, format, {
          quiet: isBulk,
          logger,
          sharpOptions: formatOptions[format]
        })
      )
    );

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

    if (tally.converted > 0) {
      logger.info(`${LOG_LABEL} Successfully converted: ${tally.converted} format(s)`);
    }
    if (tally.failed > 0) {
      logger.info(`${LOG_LABEL} Conversion errors: ${tally.failed}`);
    }
  } catch (error) {
    tally.failed += 1;
    logger.error(`${LOG_LABEL} Error while processing ${filePath}: ${error.message}`);
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
 * @param {import('vite').Logger} [options.logger=console] - Vite logger
 * @param {import("sharp").WebpOptions|import("sharp").AvifOptions} [options.sharpOptions] - Native options for the selected Sharp output method
 * @returns {Promise<"converted"|"skipped">}
 */
async function convertImage(
  sourcePath,
  targetPath,
  format,
  { quiet = false, logger = console, sharpOptions } = {}
) {
  if (existsSync(targetPath)) {
    if (!quiet) {
      logger.info(`   ${format.toUpperCase()}: target already exists, skipping`);
    }
    return "skipped";
  }

  const tempPath = `${targetPath}.${randomBytes(4).toString("hex")}.tmp`;
  const startTime = Date.now();

  try {
    await sharp(sourcePath)[format](sharpOptions).toFile(tempPath);
    await rename(tempPath, targetPath);

    const duration = Date.now() - startTime;
    logger.info(`   ${format.toUpperCase()}: converted in ${duration}ms`);
    return "converted";
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    logger.error(`   ${format.toUpperCase()}: conversion failed - ${error.message}`);
    throw error;
  }
}

/**
 * Build a "configured -> resolved" log block for a list of configured folders.
 * @param {string[]} configuredFolders - Raw folder strings from plugin config
 * @param {string[]} resolvedFolders - Absolute paths resolved from `configuredFolders`
 * @returns {string}
 */
function describeResolvedFolders(configuredFolders, resolvedFolders) {
  return configuredFolders
    .map((configured, index) => `  ${configured} -> ${resolvedFolders[index]}`)
    .join("\n");
}

/**
 * Warn once per missing resolved watch folder, pointing at the `publicDir` option as a
 * possible fix without assuming any specific framework caused the mismatch.
 * @param {string[]} configuredFolders - Raw folder strings from plugin config
 * @param {string[]} resolvedFolders - Absolute paths resolved from `configuredFolders`
 * @param {import('vite').Logger} logger - Vite logger
 */
function warnAboutMissingFolders(configuredFolders, resolvedFolders, logger) {
  resolvedFolders.forEach((resolvedFolder, index) => {
    if (existsSync(resolvedFolder)) {
      return;
    }

    logger.warnOnce(
      `${LOG_LABEL} Warning: watched folder "${configuredFolders[index]}" resolved to ` +
        `${resolvedFolder}, but it does not exist. If this path should point elsewhere, ` +
        `set the "publicDir" option explicitly or use an absolute path in "folders".`
    );
  });
}

/**
 * Determine the effective public directory used to resolve `public/...`-style paths.
 * The explicit `publicDir` plugin option always wins over Vite's own detection, because
 * frameworks like Nuxt force `resolvedConfig.publicDir` to `false` unconditionally, making
 * Vite's value unusable there regardless of `srcDir`.
 * @param {string|undefined} publicDirOption - Explicit `publicDir` plugin option
 * @param {string|false|undefined} viteConfigPublicDir - Vite's own resolved `publicDir`
 * @param {string} rootDir - Resolved Vite root
 * @returns {string}
 */
function resolveEffectivePublicDir(publicDirOption, viteConfigPublicDir, rootDir) {
  if (typeof publicDirOption === "string" && publicDirOption.length > 0) {
    return isAbsolute(publicDirOption) ? publicDirOption : resolve(rootDir, publicDirOption);
  }

  return typeof viteConfigPublicDir === "string" ? viteConfigPublicDir : "";
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
 * Check whether a path uses the reserved plugin-owned incomplete filename.
 * @param {string} filePath - Candidate absolute file path
 * @returns {boolean}
 */
function isPluginOwnedIncompletePath(filePath) {
  return INCOMPLETE_FILE_PATTERN.test(basename(filePath));
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
 * @param {"replace"|"preserve"} [outputNaming="replace"] - Output filename strategy
 * @returns {boolean}
 */
function isGeneratedFile(filePath, outputNaming = "replace") {
  const ext = extname(filePath).toLowerCase();

  if (![".avif", ".webp"].includes(ext)) {
    return false;
  }

  if (outputNaming === "preserve") {
    return existsSync(filePath.slice(0, -ext.length));
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
 * @param {"replace"|"preserve"} [outputNaming="replace"] - Output filename strategy
 * @returns {string}
 */
function getTargetPath(sourcePath, format, outputNaming = "replace") {
  const dir = dirname(sourcePath);

  if (outputNaming === "preserve") {
    return resolve(dir, `${basename(sourcePath)}.${format}`);
  }

  const ext = extname(sourcePath);
  const name = basename(sourcePath, ext);
  return resolve(dir, `${name}.${format}`);
}

/**
 * Warn when distinct sources would write the same target in replace mode.
 * @param {string[]} files - Unique absolute source paths
 * @param {Object} options - Handler options
 */
function warnAboutTargetCollisions(files, options) {
  const {
    rootDir,
    publicDir,
    exclude,
    enableAvif,
    outputNaming,
    SUPPORTED_FORMATS,
    logger
  } = options;

  if (outputNaming !== "replace") {
    return;
  }

  const sourcesByTarget = new Map();

  for (const filePath of files) {
    const ext = extname(filePath).toLowerCase();
    if (
      !SUPPORTED_FORMATS.includes(ext) ||
      isInExcludedFolder(filePath, exclude) ||
      isGeneratedFile(filePath, outputNaming)
    ) {
      continue;
    }

    const formats = [];
    if (ext !== ".webp") formats.push("webp");
    if (enableAvif) formats.push("avif");

    for (const format of formats) {
      const targetPath = getTargetPath(filePath, format, outputNaming);
      const targetKey = normalizeComparisonPath(targetPath);
      const collision = sourcesByTarget.get(targetKey) ?? {
        targetPath,
        sources: new Map()
      };
      collision.sources.set(normalizeComparisonPath(filePath), filePath);
      sourcesByTarget.set(targetKey, collision);
    }
  }

  for (const { targetPath, sources } of sourcesByTarget.values()) {
    if (sources.size < 2) continue;

    const sourceList = [...sources.values()]
      .map((sourcePath) => getDisplayPath(sourcePath, rootDir, publicDir))
      .join(", ");
    logger.warnOnce(
      `${LOG_LABEL} Warning: multiple sources map to the same output ` +
        `${getDisplayPath(targetPath, rootDir, publicDir)} (${sourceList}). ` +
        `Use outputNaming: "preserve" to keep every derivative distinct.`
    );
  }
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
 * @param {import('vite').Logger} logger - Vite logger
 * @returns {Promise<string[]>}
 */
async function listFilesRecursively(dirPath, logger) {
  const files = [];
  let entries;

  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    logger.error(`${LOG_LABEL} Failed to read directory ${dirPath}: ${error.message}`);
    return files;
  }

  for (const entry of entries) {
    const entryPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath, logger)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

/**
 * Remove stale plugin-owned incomplete files from watched, non-excluded folders.
 * @param {string[]} watchPaths - Absolute watched folder paths
 * @param {string[]} exclude - Absolute excluded folder paths
 * @param {import("vite").Logger} logger - Vite logger
 * @returns {Promise<void>}
 */
async function cleanupStaleIncompleteFiles(watchPaths, exclude, logger) {
  const filesByFolder = await Promise.all(
    watchPaths.map((folder) => (existsSync(folder) ? listFilesRecursively(folder, logger) : []))
  );
  const candidates = [
    ...new Map(
      filesByFolder
        .flat()
        .filter(
          (filePath) =>
            isPluginOwnedIncompletePath(filePath) &&
            !isInExcludedFolder(filePath, exclude)
        )
        .map((filePath) => [normalizeComparisonPath(filePath), filePath])
    ).values()
  ];
  const staleBefore = Date.now() - INCOMPLETE_FILE_TTL_MS;
  let removed = 0;

  await runWithConcurrencyLimit(candidates, MIN_BULK_CONCURRENCY, async (filePath) => {
    try {
      const fileStats = await lstat(filePath);
      if (!fileStats.isFile() || fileStats.mtimeMs > staleBefore) return;
      await rm(filePath);
      removed += 1;
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.warn(
          `${LOG_LABEL} Failed to clean incomplete file ${filePath}: ${error.message}`
        );
      }
    }
  });

  if (removed > 0) {
    logger.info(`${LOG_LABEL} Removed ${removed} stale incomplete conversion file(s)`);
  }
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
 * @param {(filePath: string, options: Object) => Promise<{converted: number, skipped: number, failed: number}>} [processFile=handleFileAdd] - File processor
 * @returns {Promise<void>}
 */
async function runInitialPass(watchPaths, handlerOptions, processFile = handleFileAdd) {
  const { logger } = handlerOptions;
  const filesByFolder = await Promise.all(
    watchPaths.map((folder) => (existsSync(folder) ? listFilesRecursively(folder, logger) : []))
  );
  const files = [
    ...new Map(
      filesByFolder
        .flat()
        .map((filePath) => [normalizeComparisonPath(filePath), filePath])
    ).values()
  ];

  warnAboutTargetCollisions(files, handlerOptions);

  const summary = { processed: files.length, converted: 0, skipped: 0, failed: 0 };
  const concurrency = Math.max(MIN_BULK_CONCURRENCY, cpus().length);

  await runWithConcurrencyLimit(files, concurrency, async (filePath) => {
    const result = await processFile(filePath, { ...handlerOptions, isBulk: true });
    summary.converted += result.converted;
    summary.skipped += result.skipped;
    summary.failed += result.failed;
  });

  logger.info(
    `${LOG_LABEL} Initial pass complete: processed ${summary.processed}, converted ${summary.converted}, skipped ${summary.skipped}, failed ${summary.failed}`
  );
}
