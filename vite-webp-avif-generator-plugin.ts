import { resolve, dirname, extname, basename, relative, isAbsolute } from 'path';
import { access, constants } from 'fs/promises';
import sharp from 'sharp';
import chokidar from 'chokidar';
import { normalizePath } from 'vite';
import type { Plugin, ResolvedConfig } from 'vite';

/**
 * Конфигурация плагина для конвертации изображений
 */
export interface PluginConfig {
  /**
   * Папки для отслеживания изображений
   * @default ['src/img', 'public/img']
   */
  folders?: string[];

  /**
   * Папки для исключения из обработки
   * @default []
   */
  exclude?: string[];

  /**
   * Включить конвертацию в формат AVIF
   * @default true
   */
  enableAvif?: boolean;

  /**
   * Настройки качества для WebP
   * @default { quality: 80 }
   */
  webpOptions?: {
    /** Качество изображения (0-100) @default 80 */
    quality?: number;
    /** Использовать lossless сжатие @default false */
    lossless?: boolean;
    /** Уровень компрессии (0-6) @default 4 */
    effort?: number;
  };

  /**
   * Настройки качества для AVIF
   * @default { quality: 75 }
   */
  avifOptions?: {
    /** Качество изображения (0-100) @default 75 */
    quality?: number;
    /** Использовать lossless сжатие @default false */
    lossless?: boolean;
    /** Уровень компрессии (0-9) @default 4 */
    effort?: number;
  };

  /**
   * Подробное логирование
   * @default true
   */
  verbose?: boolean;
}

/**
 * Опции для обработки файла
 */
interface HandleFileOptions {
  rootDir: string;
  exclude: string[];
  enableAvif: boolean;
  webpOptions: Required<PluginConfig['webpOptions']>;
  avifOptions: Required<PluginConfig['avifOptions']>;
  verbose: boolean;
  SUPPORTED_FORMATS: string[];
}

/**
 * Дефолтные опции плагина
 */
const defaultOptions: Required<Omit<PluginConfig, 'folders' | 'exclude'>> & Pick<PluginConfig, 'folders' | 'exclude'> = {
  folders: ['src/img', 'public/img'],
  exclude: [],
  enableAvif: true,
  webpOptions: {
    quality: 80,
    lossless: false,
    effort: 4
  },
  avifOptions: {
    quality: 75,
    lossless: false,
    effort: 4
  },
  verbose: true
};

/**
 * Vite плагин для автоматической конвертации изображений в WebP и AVIF в dev режиме
 * 
 * @param config - Конфигурация плагина
 * @returns Vite плагин
 * 
 * @example
 * ```ts
 * import convertImages from 'vite-webp-avif-generator-plugin';
 * 
 * export default defineConfig({
 *   plugins: [
 *     convertImages({
 *       folders: ['src/img', 'public/img'],
 *       exclude: ['src/img/temp'],
 *       enableAvif: true,
 *       webpOptions: { quality: 85 },
 *       avifOptions: { quality: 80 },
 *       verbose: true
 *     })
 *   ]
 * });
 * ```
 */
export default function convertImages(config: PluginConfig = {}): Plugin {
  const options = {
    ...defaultOptions,
    ...config,
    webpOptions: { ...defaultOptions.webpOptions, ...config.webpOptions },
    avifOptions: { ...defaultOptions.avifOptions, ...config.avifOptions }
  };

  // Поддерживаемые форматы
  const SUPPORTED_FORMATS = ['.jpg', '.jpeg', '.png', '.webp'];

  let rootDir = process.cwd();

  /**
   * Логирование с учетом verbose режима
   */
  function log(...args: any[]): void {
    if (options.verbose) {
      console.log(...args);
    }
  }

  return {
    name: 'vite-webp-avif-generator',

    configResolved(resolvedConfig: ResolvedConfig): void {
      rootDir = resolvedConfig.root || process.cwd();
    },

    configureServer(server): void {
      const watchPaths = validateFolders(options.folders, rootDir);

      log('\n🎨 [Image Converter] Starting file watcher...');
      log(`📁 Watching folders: ${options.folders.join(', ')}`);
      if (options.exclude.length > 0) {
        log(`🚫 Excluded folders: ${options.exclude.join(', ')}`);
      }
      log(`⚙️  AVIF conversion: ${options.enableAvif ? 'enabled' : 'disabled'}`);
      log(`🎨 WebP quality: ${options.webpOptions.quality}, AVIF quality: ${options.avifOptions.quality}\n`);

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
      watcher.on('add', async (filePath: string) => {
        await handleFileAdd(filePath, {
          rootDir,
          exclude: options.exclude,
          enableAvif: options.enableAvif,
          webpOptions: options.webpOptions,
          avifOptions: options.avifOptions,
          verbose: options.verbose,
          SUPPORTED_FORMATS
        });
      });

      // Обработка ошибок watcher
      watcher.on('error', (error: Error) => {
        console.error('❌ [Image Converter] File watcher error:', error);
      });

      // Закрытие watcher при остановке сервера
      server.httpServer?.on('close', () => {
        watcher.close();
        log('\n🛑 [Image Converter] File watcher stopped');
      });
    }
  };
}

/**
 * Проверка существования файла (async)
 * @param path - Путь к файлу
 * @returns Promise с boolean результатом
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Валидация папок против path traversal атак
 * @param folders - Список папок
 * @param rootDir - Корневая директория
 * @returns Валидированные абсолютные пути
 * @throws {Error} если путь выходит за пределы проекта
 */
function validateFolders(folders: string[], rootDir: string): string[] {
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
 * @param filePath - Путь к добавленному файлу
 * @param options - Опции обработки
 */
async function handleFileAdd(filePath: string, options: HandleFileOptions): Promise<void> {
  const { rootDir, exclude, enableAvif, webpOptions, avifOptions, verbose, SUPPORTED_FORMATS } = options;

  const log = (...args: any[]) => {
    if (verbose) console.log(...args);
  };

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
    if (await isGeneratedFile(filePath, rootDir)) {
      return;
    }

    log(`\n📸 [Image Converter] New file detected: ${getRelativePath(filePath, rootDir)}`);

    // Определяем какие конвертации нужны
    const conversions: Array<{ format: 'webp' | 'avif'; targetPath: string; options: any }> = [];
    const isWebP = ext === '.webp';

    // WebP: конвертируем только если исходник НЕ webp
    if (!isWebP) {
      conversions.push({
        format: 'webp',
        targetPath: getTargetPath(filePath, 'webp'),
        options: webpOptions
      });
    }

    // AVIF: конвертируем всегда (если enableAvif=true)
    if (enableAvif) {
      conversions.push({
        format: 'avif',
        targetPath: getTargetPath(filePath, 'avif'),
        options: avifOptions
      });
    }

    // Параллельная конвертация
    const results = await Promise.allSettled(
      conversions.map(({ format, targetPath, options }) =>
        convertImage(filePath, targetPath, format, options, verbose)
      )
    );

    // Подсчет результатов
    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    if (successful > 0) {
      log(`✅ Successfully converted: ${successful} format(s)`);
    }
    if (failed > 0) {
      console.error(`❌ Conversion errors: ${failed}`);
    }
  } catch (error) {
    console.error(
      `❌ [Image Converter] Error processing file ${filePath}:`,
      (error as Error).message
    );
  }
}

/**
 * Конвертация изображения в указанный формат
 * @param sourcePath - Путь к исходному файлу
 * @param targetPath - Путь к целевому файлу
 * @param format - Целевой формат (webp/avif)
 * @param formatOptions - Опции для формата
 * @param verbose - Включить подробное логирование
 */
async function convertImage(
  sourcePath: string, 
  targetPath: string, 
  format: 'webp' | 'avif',
  formatOptions: any,
  verbose: boolean
): Promise<void> {
  // Пропускаем если файл уже существует
  if (await fileExists(targetPath)) {
    if (verbose) {
      console.log(`   ⏭️  ${format.toUpperCase()}: already exists, skipping`);
    }
    return;
  }

  const startTime = Date.now();

  try {
    const sharpInstance = sharp(sourcePath);
    
    // Применяем опции для конкретного формата
    if (format === 'webp') {
      await sharpInstance.webp(formatOptions).toFile(targetPath);
    } else if (format === 'avif') {
      await sharpInstance.avif(formatOptions).toFile(targetPath);
    }

    const duration = Date.now() - startTime;
    
    if (verbose) {
      const stats = await import('fs/promises').then(fs => fs.stat(targetPath));
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(
        `   ✓ ${format.toUpperCase()}: converted in ${duration}ms (size: ${sizeMB}MB, quality: ${formatOptions.quality})`
      );
    }
  } catch (error) {
    console.error(
      `   ✗ ${format.toUpperCase()}: conversion error - ${(error as Error).message}`
    );
    throw error;
  }
}

/**
 * Проверка, находится ли файл в исключенной папке
 * @param filePath - Путь к файлу
 * @param exclude - Список исключенных папок
 * @param rootDir - Корневая директория
 * @returns true если файл в исключенной папке
 */
function isInExcludedFolder(filePath: string, exclude: string[], rootDir: string): boolean {
  if (exclude.length === 0) return false;

  const relativePath = normalizePath(getRelativePath(filePath, rootDir));

  return exclude.some((excludePath) => {
    const normalizedExclude = normalizePath(excludePath);

    // Проверяем точное совпадение папки или вложенность
    return (
      relativePath === normalizedExclude ||
      relativePath.startsWith(normalizedExclude + '/')
    );
  });
}

/**
 * Проверка, является ли файл сгенерированным (webp/avif)
 * Улучшенная версия с поддержкой вложенных структур
 * 
 * @param filePath - Путь к файлу
 * @param rootDir - Корневая директория проекта
 * @returns Promise с boolean результатом
 */
async function isGeneratedFile(filePath: string, rootDir: string): Promise<boolean> {
  const ext = extname(filePath).toLowerCase();

  // Проверяем ТОЛЬКО для webp/avif файлов
  // JPG/PNG/другие форматы всегда считаются оригиналами
  if (!['.avif', '.webp'].includes(ext)) {
    return false;
  }

  const fileNameWithoutExt = basename(filePath, ext);
  const dirPath = dirname(filePath);
  const possibleOriginals = ['.jpg', '.jpeg', '.png'];

  // 1. Проверяем в той же директории
  for (const originalExt of possibleOriginals) {
    const originalPath = resolve(dirPath, fileNameWithoutExt + originalExt);
    if (await fileExists(originalPath)) {
      return true;
    }
  }

  // 2. Проверяем в родительских директориях (до корня проекта)
  // Это для случаев когда структура типа:
  // src/img/category/original.jpg
  // src/img/category/subfolder/original.webp (скопировано из другого места)
  let currentDir = dirname(dirPath);
  const normalizedRoot = normalizePath(rootDir);
  
  while (currentDir !== normalizedRoot && currentDir.startsWith(normalizedRoot)) {
    for (const originalExt of possibleOriginals) {
      const originalPath = resolve(currentDir, fileNameWithoutExt + originalExt);
      if (await fileExists(originalPath)) {
        return true;
      }
    }
    
    const parentDir = dirname(currentDir);
    // Предотвращаем бесконечный цикл
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  // 3. Проверяем в дочерних директориях (один уровень вложенности)
  // Это редкий случай, но может быть полезно
  // Ограничиваем проверку одним уровнем для производительности
  
  return false; // Не нашли оригинал - считаем оригинальным WebP/AVIF
}

/**
 * Получить путь к целевому файлу
 * @param sourcePath - Путь к исходному файлу
 * @param format - Целевой формат
 * @returns Путь к целевому файлу
 */
function getTargetPath(sourcePath: string, format: string): string {
  const dir = dirname(sourcePath);
  const ext = extname(sourcePath);
  const name = basename(sourcePath, ext);
  return resolve(dir, `${name}.${format}`);
}

/**
 * Получить относительный путь от корня
 * @param filePath - Абсолютный путь к файлу
 * @param rootDir - Корневая директория
 * @returns Относительный путь
 */
function getRelativePath(filePath: string, rootDir: string): string {
  return relative(rootDir, filePath);
}

