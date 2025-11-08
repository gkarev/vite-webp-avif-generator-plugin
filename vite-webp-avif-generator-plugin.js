import { resolve, dirname, extname, basename, relative, isAbsolute } from "path";
import { access, constants } from "fs/promises";
import sharp from "sharp";
import chokidar from "chokidar";
import { normalizePath } from "vite";

/**
 * @typedef {Object} PluginConfig
 * @property {string[]} [folders=['src/img', 'public/img']] - Папки для отслеживания
 * @property {string[]} [exclude=[]] - Папки для исключения
 * @property {boolean} [enableAvif=true] - Включить конвертацию в AVIF
 */

/**
 * Vite plugin для автоматической конвертации изображений в WebP и AVIF в dev режиме
 * @param {PluginConfig} [config={}] - Конфигурация плагина
 * @returns {import('vite').Plugin}
 */
export default function convertImages(config = {}) {
  const {
    folders = ["src/img", "public/img"],
    exclude = [],
    enableAvif = true
  } = config;

  // Поддерживаемые форматы
  const SUPPORTED_FORMATS = [".jpg", ".jpeg", ".png", ".webp"];

  let rootDir = process.cwd();

  return {
    name: "vite-webp-avif-generator",

    configResolved(resolvedConfig) {
      rootDir = resolvedConfig.root || process.cwd();
    },

    configureServer(server) {
      const watchPaths = validateFolders(folders, rootDir);

      console.log("\n🎨 [Image Converter] Starting file watcher...");
      console.log(`📁 Watching folders: ${folders.join(", ")}`);
      if (exclude.length > 0) {
        console.log(`🚫 Excluded folders: ${exclude.join(", ")}`);
      }
      console.log(
        `⚙️  AVIF conversion: ${enableAvif ? "enabled" : "disabled"}\n`
      );

      // Инициализация chokidar watcher
      const watcher = chokidar.watch(watchPaths, {
        persistent: true,
        ignoreInitial: true, // Не обрабатываем существующие файлы при старте
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        }
      });

      // Обработчик добавления файла
      watcher.on("add", async (filePath) => {
        await handleFileAdd(filePath, {
          rootDir,
          exclude,
          enableAvif,
          SUPPORTED_FORMATS
        });
      });

      // Обработка ошибок watcher
      watcher.on("error", (error) => {
        console.error("❌ [Image Converter] File watcher error:", error);
      });

      // Закрытие watcher при остановке сервера
      server.httpServer?.on("close", () => {
        watcher.close();
        console.log("\n🛑 [Image Converter] File watcher stopped");
      });
    }
  };
}

/**
 * Проверка существования файла (async)
 * @param {string} path - Путь к файлу
 * @returns {Promise<boolean>}
 */
async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Валидация папок против path traversal атак
 * @param {string[]} folders - Список папок
 * @param {string} rootDir - Корневая директория
 * @returns {string[]} Валидированные абсолютные пути
 */
function validateFolders(folders, rootDir) {
  return folders.map(folder => {
    const absolutePath = resolve(rootDir, folder);
    const relativePath = relative(rootDir, absolutePath);
    
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error(
        `❌ Security: folder "${folder}" is outside project root\n` +
        `   Project root: ${rootDir}\n` +
        `   Attempted path: ${absolutePath}\n\n` +
        `   Valid examples: 'src/img', 'public/img', './assets'\n` +
        `   Invalid examples: '../other-project', '/etc/passwd'\n\n` +
        `   💡 Tip: All paths must be inside your project directory.`
      );
    }
    
    return normalizePath(absolutePath);
  });
}

/**
 * Обработка добавления нового файла
 * @param {string} filePath - Путь к добавленному файлу
 * @param {Object} options - Опции обработки
 */
async function handleFileAdd(filePath, options) {
  const { rootDir, exclude, enableAvif, SUPPORTED_FORMATS } = options;

  try {
    // Проверка 1: Поддерживаемый формат
    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_FORMATS.includes(ext)) {
      return;
    }

    // Проверка 2: Не в исключенных папках
    if (isInExcludedFolder(filePath, exclude, rootDir)) {
      return;
    }

    // Проверка 3: Не является сгенерированным файлом
    if (await isGeneratedFile(filePath)) {
      return;
    }

    console.log(
      `\n📸 [Image Converter] New file detected: ${getRelativePath(filePath, rootDir)}`
    );

    // Определяем какие конвертации нужны
    const conversions = [];
    const isWebP = ext === ".webp";

    // WebP: конвертируем только если исходник НЕ webp
    if (!isWebP) {
      conversions.push({
        format: "webp",
        targetPath: getTargetPath(filePath, "webp")
      });
    }

    // AVIF: конвертируем всегда (если enableAvif=true)
    if (enableAvif) {
      conversions.push({
        format: "avif",
        targetPath: getTargetPath(filePath, "avif")
      });
    }

    // Параллельная конвертация
    const results = await Promise.allSettled(
      conversions.map(({ format, targetPath }) =>
        convertImage(filePath, targetPath, format)
      )
    );

    // Подсчет результатов
    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    if (successful > 0) {
      console.log(`✅ Successfully converted: ${successful} format(s)`);
    }
    if (failed > 0) {
      console.log(`❌ Conversion errors: ${failed}`);
    }
  } catch (error) {
    console.error(
      `❌ [Image Converter] Error processing file ${filePath}:`,
      error.message
    );
  }
}

/**
 * Конвертация изображения в указанный формат
 * @param {string} sourcePath - Путь к исходному файлу
 * @param {string} targetPath - Путь к целевому файлу
 * @param {string} format - Целевой формат (webp/avif)
 * @returns {Promise<void>}
 */
async function convertImage(sourcePath, targetPath, format) {
  // Пропускаем если файл уже существует
  if (await fileExists(targetPath)) {
    console.log(
      `   ⏭️  ${format.toUpperCase()}: already exists, skipping`
    );
    return;
  }

  const startTime = Date.now();

  try {
    await sharp(sourcePath)
      [format]() // Используем стандартные настройки sharp
      .toFile(targetPath);

    const duration = Date.now() - startTime;
    console.log(
      `   ✓ ${format.toUpperCase()}: converted in ${duration}ms`
    );
  } catch (error) {
    console.error(
      `   ✗ ${format.toUpperCase()}: conversion error - ${error.message}`
    );
    throw error;
  }
}

/**
 * Проверка, находится ли файл в исключенной папке
 * @param {string} filePath - Путь к файлу
 * @param {string[]} exclude - Список исключенных папок
 * @param {string} rootDir - Корневая директория
 * @returns {boolean}
 */
function isInExcludedFolder(filePath, exclude, rootDir) {
  if (exclude.length === 0) return false;

  const relativePath = normalizePath(getRelativePath(filePath, rootDir));

  return exclude.some((excludePath) => {
    const normalizedExclude = normalizePath(excludePath);

    // Проверяем точное совпадение папки или вложенность
    return (
      relativePath === normalizedExclude ||
      relativePath.startsWith(normalizedExclude + "/")
    );
  });
}

/**
 * Проверка, является ли файл сгенерированным (webp/avif)
 * @param {string} filePath - Путь к файлу
 * @returns {Promise<boolean>}
 */
async function isGeneratedFile(filePath) {
  const ext = extname(filePath).toLowerCase();

  // Проверяем ТОЛЬКО для webp/avif файлов
  // JPG/PNG/другие форматы всегда считаются оригиналами
  if (![".avif", ".webp"].includes(ext)) {
    return false;
  }

  // Для webp/avif проверяем существование оригинала
  const fileNameWithoutExt = basename(filePath, ext);
  const dirPath = dirname(filePath);
  const possibleOriginals = [".jpg", ".jpeg", ".png"];

  for (const originalExt of possibleOriginals) {
    const originalPath = resolve(dirPath, fileNameWithoutExt + originalExt);
    if (await fileExists(originalPath)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Получить путь к целевому файлу
 * @param {string} sourcePath - Путь к исходному файлу
 * @param {string} format - Целевой формат
 * @returns {string}
 */
function getTargetPath(sourcePath, format) {
  const dir = dirname(sourcePath);
  const ext = extname(sourcePath);
  const name = basename(sourcePath, ext);
  return resolve(dir, `${name}.${format}`);
}

/**
 * Получить относительный путь от корня
 * @param {string} filePath - Абсолютный путь к файлу
 * @param {string} rootDir - Корневая директория
 * @returns {string}
 */
function getRelativePath(filePath, rootDir) {
  return relative(rootDir, filePath);
}
