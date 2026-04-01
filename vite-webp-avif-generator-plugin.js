import { resolve, dirname, extname, basename, relative, isAbsolute } from "path";
import { existsSync } from "fs";
import { normalizePath } from "vite";
import sharp from "sharp";
import chokidar from "chokidar";

/**
 * @typedef {Object} PluginConfig
 * @property {string[]} [folders=['src/img', 'public/img']] - Folders to watch
 * @property {string[]} [exclude=[]] - Folders to exclude
 * @property {boolean} [enableAvif=true] - Enable AVIF conversion
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
    enableAvif = true
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

      return () => {
        watcher.close();
        console.log("\n[Image Converter] File watcher stopped");
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
 * @param {string[]} options.SUPPORTED_FORMATS - Supported source formats
 */
async function handleFileAdd(filePath, options) {
  const { rootDir, publicDir, exclude, enableAvif, SUPPORTED_FORMATS } = options;

  try {
    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_FORMATS.includes(ext)) {
      return;
    }

    if (isInExcludedFolder(filePath, exclude)) {
      return;
    }

    if (isGeneratedFile(filePath)) {
      return;
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
        convertImage(filePath, targetPath, format)
      )
    );

    const successful = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.filter((result) => result.status === "rejected").length;

    if (successful > 0) {
      console.log(`[Image Converter] Successfully converted: ${successful} format(s)`);
    }
    if (failed > 0) {
      console.log(`[Image Converter] Conversion errors: ${failed}`);
    }
  } catch (error) {
    console.error(
      `[Image Converter] Error while processing ${filePath}:`,
      error.message
    );
  }
}

/**
 * Convert an image to the requested format.
 * @param {string} sourcePath - Source image path
 * @param {string} targetPath - Target image path
 * @param {string} format - Target format (webp/avif)
 * @returns {Promise<void>}
 */
async function convertImage(sourcePath, targetPath, format) {
  if (existsSync(targetPath)) {
    console.log(`   ${format.toUpperCase()}: target already exists, skipping`);
    return;
  }

  const startTime = Date.now();

  try {
    await sharp(sourcePath)[format]().toFile(targetPath);

    const duration = Date.now() - startTime;
    console.log(`   ${format.toUpperCase()}: converted in ${duration}ms`);
  } catch (error) {
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
