import { resolve, dirname, extname, basename, relative } from "path";
import { existsSync } from "fs";
import sharp from "sharp";
import chokidar from "chokidar";

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
      const watchPaths = folders.map((folder) => resolve(rootDir, folder));

      console.log("\n🎨 [Image Converter] Запуск файлового watcher...");
      console.log(`📁 Отслеживаемые папки: ${folders.join(", ")}`);
      if (exclude.length > 0) {
        console.log(`🚫 Исключенные папки: ${exclude.join(", ")}`);
      }
      console.log(
        `⚙️  AVIF конвертация: ${enableAvif ? "включена" : "отключена"}\n`
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
        console.error("❌ [Image Converter] Ошибка file watcher:", error);
      });

      // Закрытие watcher при остановке сервера
      server.httpServer?.on("close", () => {
        watcher.close();
        console.log("\n🛑 [Image Converter] File watcher остановлен");
      });
    }
  };
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
    if (isGeneratedFile(filePath)) {
      return;
    }

    console.log(
      `\n📸 [Image Converter] Обнаружен новый файл: ${getRelativePath(filePath, rootDir)}`
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
      console.log(`✅ Успешно сконвертировано: ${successful} формат(ов)`);
    }
    if (failed > 0) {
      console.log(`❌ Ошибок конвертации: ${failed}`);
    }
  } catch (error) {
    console.error(
      `❌ [Image Converter] Ошибка обработки файла ${filePath}:`,
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
  if (existsSync(targetPath)) {
    console.log(
      `   ⏭️  ${format.toUpperCase()}: файл уже существует, пропускаем`
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
      `   ✓ ${format.toUpperCase()}: сконвертировано за ${duration}ms`
    );
  } catch (error) {
    console.error(
      `   ✗ ${format.toUpperCase()}: ошибка конвертации - ${error.message}`
    );
    throw error;
  }
}

/**
 * Нормализация пути (унификация слэшей и удаление лишних)
 * @param {string} path - Путь для нормализации
 * @returns {string}
 */
function normalizePath(path) {
  return path
    .replace(/\\/g, "/") // Windows → Unix слэши
    .replace(/^\/+/, "") // Убираем ведущие слэши
    .replace(/\/+$/, ""); // Убираем конечные слэши
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
 * @returns {boolean}
 */
function isGeneratedFile(filePath) {
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

  return possibleOriginals.some((originalExt) => {
    const originalPath = resolve(dirPath, fileNameWithoutExt + originalExt);
    return existsSync(originalPath);
  });
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
