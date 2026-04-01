# Vite WebP & AVIF Generator Plugin

Vite plugin for automatic image conversion to WebP and AVIF during dev server runtime.

## Features

- Converts newly added images in watched folders
- Skips existing targets to avoid extra work
- Avoids loops on generated `.webp` and `.avif` files
- Runs WebP and AVIF conversions in parallel
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

Existing files are ignored on startup because the watcher uses `ignoreInitial: true`.

## Compatibility

- Vite `4.x` to `8.x`
- Nuxt projects powered by Vite, including `srcDir` setups
- Chokidar `3.5.3+` and `4.x`
- Sharp `0.32+`, `0.33+`, `0.34+`

Node runtime depends on the Vite major used in the host project.

For the currently declared package support:
- Vite `7.x` to `8.x`: Node `20.19+`

If you plan to use older Vite majors, align the project runtime with that Vite version's official Node requirements.

## Notes

- The plugin is intentionally dev-only.
- The main conversion flow is file-system based and does not transform Vite modules.
- If you change runtime behavior, update the runtime file, typings, and README together.
