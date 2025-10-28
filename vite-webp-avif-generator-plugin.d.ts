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
 * // С настройками
 * convertImages({
 *   folders: ['src/img', 'public/img'],
 *   exclude: ['src/img/temp'],
 *   enableAvif: true
 * })
 * ```
 */
export default function convertImages(config?: PluginConfig): Plugin;

