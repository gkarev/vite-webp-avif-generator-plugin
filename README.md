# Vite WebP & AVIF Generator Plugin

Vite plugin for automatic image conversion to WebP and AVIF during dev server runtime.

## Features

- Converts newly added images in watched folders
- Runs a one-time initial pass on server start to convert pre-existing images
- Skips existing targets to avoid extra work
- Avoids loops on generated `.webp` and `.avif` files
- Runs WebP and AVIF conversions in parallel
- Writes converted files atomically (temp file + rename)
- Supports Vite `publicDir` when it lives outside Vite `root`
- Supports Nuxt setups with `srcDir` and project-level `public/`
- Works in dev only via `apply: 'serve'`

## Installation

```bash
npm install -D vite-webp-avif-generator-plugin sharp chokidar
```

## Basic Usage

```js
// vite.config.js
import { defineConfig } from 'vite'
import convertImages from 'vite-webp-avif-generator-plugin'

export default defineConfig({
  plugins: [convertImages()],
})
```

## Nuxt Support

The plugin supports Nuxt projects where Vite `root` is moved by `srcDir`, while static assets still live in the project-level `public/` directory.

That means you can keep paths like `public/img` in plugin options without overriding Vite `root` in development.

Example:

```ts
convertImages({
  folders: ['src/assets/img', 'public/img'],
  exclude: ['public/img/generated'],
})
```

This is especially useful for setups like:

```ts
export default defineNuxtConfig({
  srcDir: './src',
})
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `folders` | `string[]` | `['src/img', 'public/img']` | Folders to watch |
| `exclude` | `string[]` | `[]` | Folders to exclude |
| `enableAvif` | `boolean` | `true` | Enable AVIF conversion |
| `enableInitialPass` | `boolean` | `true` | Run a one-time conversion pass for existing files on server start |

## Path Resolution

- Absolute paths are used as-is.
- Relative paths are resolved from Vite `root`.
- Paths that start with the configured public directory name, for example `public/img`, are resolved from the parent of Vite `publicDir`.

This keeps the plugin compatible with standard Vite apps and with frameworks such as Nuxt that can shift the effective Vite root.

## Supported Formats

Input:
- `.jpg`
- `.jpeg`
- `.png`
- `.webp`

Output:
- `.webp` when source is not already WebP
- `.avif` when `enableAvif` is `true`

## Behavior

On each new file:
1. Check supported extension
2. Check excluded folders
3. Skip generated `.webp` and `.avif` files
4. Build conversion tasks
5. Run conversions with `Promise.allSettled`
6. Log success and error counts

Files are converted atomically: each output is written to a temporary file next to the
target and then renamed into place, so an interrupted conversion never leaves a partial
target file behind.

### Initial Pass

When the dev server starts, the plugin registers the file watcher first (so files added
while the pass is running are still picked up live), waits for the watcher's `ready`
event so live watching is fully active, then runs a one-time pass over all files already
present in the watched folders, applying the same filters and idempotency checks as live
additions (existing targets are skipped without invoking `sharp`). The pass recurses into
subfolders, does not follow symlinks, limits how many conversions run concurrently, and
finishes with a single summary log line (processed/converted/skipped/failed).

Set `enableInitialPass: false` to disable this pass and only convert files added while
the server is running.

## Compatibility

- Vite `4.x` to `8.x`
- Nuxt projects powered by Vite, including `srcDir` setups
- Chokidar `3.5.3+` and `4.x`
- Sharp `0.32+`, `0.33+`, `0.34+`
- Node `20.19+`, regardless of which supported Vite major you use

The plugin declares `"engines": { "node": ">=20.19.0" }` unconditionally, so this Node
requirement applies even if your project uses an older Vite major (`4.x`-`6.x`) that
itself supports lower Node versions.

## Notes

- The plugin is intentionally dev-only.
- The main conversion flow is file-system based and does not transform Vite modules.
- If you change runtime behavior, update the runtime file, typings, and README together.
