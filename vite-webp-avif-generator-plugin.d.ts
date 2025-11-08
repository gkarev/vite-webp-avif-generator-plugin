import type { Plugin } from 'vite';

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
   * @default { quality: 80, lossless: false, effort: 4 }
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
   * @default { quality: 75, lossless: false, effort: 4 }
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
 * Vite плагин для автоматической конвертации изображений в WebP и AVIF
 *
 * @param config - Конфигурация плагина
 * @returns Vite плагин
 *
 * @example
 * ```js
 * // Базовое использование
 * convertImages()
 * ```
 *
 * @example
 * ```js
 * // С настройками качества
 * convertImages({
 *   folders: ['src/img', 'public/img'],
 *   exclude: ['src/img/temp'],
 *   enableAvif: true,
 *   webpOptions: { quality: 85, effort: 5 },
 *   avifOptions: { quality: 80, effort: 6 },
 *   verbose: true
 * })
 * ```
 */
export default function convertImages(config?: PluginConfig): Plugin;
