import type { Plugin } from 'vite';

/**
 * Plugin configuration for image conversion.
 */
export interface PluginConfig {
  /**
   * Folders to watch.
   * Relative paths are resolved from Vite `root`, except paths that start with the
   * configured public directory name (for example `public/...`), which are resolved
   * from the parent of Vite `publicDir`.
   *
   * This keeps `public/...` working in frameworks like Nuxt where Vite `root`
   * may be moved to `srcDir`.
   *
   * @default ['src/img', 'public/img']
   */
  folders?: string[];

  /**
   * Folders to exclude from processing.
   * Resolution rules match `folders`.
   *
   * @default []
   */
  exclude?: string[];

  /**
   * Enable AVIF conversion.
   *
   * @default true
   */
  enableAvif?: boolean;
}

/**
 * Vite plugin for automatic image conversion to WebP and AVIF in dev mode.
 */
export default function convertImages(config?: PluginConfig): Plugin;
