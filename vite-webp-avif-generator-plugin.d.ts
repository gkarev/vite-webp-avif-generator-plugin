import type { Plugin } from 'vite';

/**
 * Plugin configuration for image conversion.
 */
export interface PluginConfig {
  /**
   * Folders to watch.
   * Relative paths are resolved from Vite `root`, except paths that start with the
   * configured public directory name (for example `public/...`), which are resolved
   * from the parent of the effective `publicDir` (the `publicDir` option if set,
   * otherwise Vite's own detected `publicDir`).
   *
   * In frameworks like Nuxt, Vite's own `publicDir` is always `false`, so set the
   * `publicDir` option explicitly to keep `public/...` paths working there.
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

  /**
   * Run a one-time conversion pass for existing files on server start.
   *
   * @default true
   */
  enableInitialPass?: boolean;

  /**
   * Output filename strategy. `replace` drops the source extension
   * (`logo.png` -> `logo.webp`); `preserve` keeps it
   * (`logo.png` -> `logo.png.webp`).
   *
   * @default 'replace'
   */
  outputNaming?: 'replace' | 'preserve';

  /**
   * Native options passed unchanged to Sharp's `.webp()` output method.
   * Omit this field to use Sharp's own WebP defaults.
   */
  webpOptions?: import('sharp').WebpOptions;

  /**
   * Native options passed unchanged to Sharp's `.avif()` output method.
   * Omit this field to use Sharp's own AVIF defaults.
   */
  avifOptions?: import('sharp').AvifOptions;

  /**
   * Explicit public directory used to resolve `public/...`-style `folders`/`exclude`
   * entries, overriding Vite's own `publicDir` detection.
   *
   * Required for reliable Nuxt support: Nuxt always sets Vite's `publicDir` to `false`,
   * regardless of `srcDir`, so it cannot be auto-detected there. Relative values are
   * resolved from Vite `root`; absolute values are used as-is.
   */
  publicDir?: string;
}

/**
 * Vite plugin for automatic image conversion to WebP and AVIF in dev mode.
 */
export default function convertImages(config?: PluginConfig): Plugin;
