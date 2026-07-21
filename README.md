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
- Optional `publicDir` override for frameworks (like Nuxt) where Vite's own `publicDir` can't be auto-detected
- Works in dev only via `apply: 'serve'`

## Installation

```bash
npm install -D vite-webp-avif-generator-plugin
```

`sharp` and `chokidar` are installed automatically as regular dependencies.

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

Nuxt always sets Vite's own `publicDir` option to `false`, on both the client and
server/SSR dev servers it creates, regardless of `srcDir`. This is enforced by Nuxt
itself (`vite.publicDir` is deliberately not configurable — see the
[Nuxt config reference](https://nuxt.com/docs/api/nuxt-config#publicdir)), so the
plugin cannot auto-detect a real `publicDir` in Nuxt the way it can in a standard Vite
project.

As a result, relative `public/img`-style paths in `folders`/`exclude` are **not**
reliable in Nuxt on their own — they resolve against Vite `root` (which Nuxt sets to
`srcDir`), not against the project's actual `public/` directory. If `srcDir` differs
from the project root, this silently resolves to a folder that doesn't exist, and the
initial pass logs `processed 0`.

Use the `publicDir` option to point the plugin at the real public directory explicitly:

```ts
import { resolve } from 'node:path'

convertImages({
  folders: ['src/assets/img', 'public/img'],
  exclude: ['public/img/generated'],
  publicDir: resolve(process.cwd(), 'public'),
})
```

This is especially useful for setups like:

```ts
export default defineNuxtConfig({
  srcDir: './src',
})
```

If you see `processed 0` in the initial-pass summary, or a
`Warning: watched folder "..." resolved to ..., but it does not exist` log line, check
the resolved path logged at startup and set `publicDir` (or use an absolute path in
`folders`) to fix it.

The file watcher is closed by wrapping the dev server's own `close()` method, so
cleanup does not depend on `server.httpServer` (which is `null` in Nuxt's middleware
mode). Nuxt actually runs two separate Vite dev servers from the same plugin instance
(one for the client build, one for the server/SSR build); because cleanup is scoped to
each server instance individually, both watchers are closed independently with no
leaks, whether the dev server shuts down or restarts in the same process.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `folders` | `string[]` | `['src/img', 'public/img']` | Folders to watch |
| `exclude` | `string[]` | `[]` | Folders to exclude |
| `enableAvif` | `boolean` | `true` | Enable AVIF conversion |
| `enableInitialPass` | `boolean` | `true` | Run a one-time conversion pass for existing files on server start |
| `publicDir` | `string` | _(unset)_ | Explicit public directory used to resolve `public/...`-style `folders`/`exclude` entries, overriding Vite's own `publicDir` detection. Required for reliable Nuxt support (see [Nuxt Support](#nuxt-support)). |
| `webpOptions` | `import('sharp').WebpOptions` | _(unset)_ | Native options passed unchanged to Sharp's `.webp()` method |
| `avifOptions` | `import('sharp').AvifOptions` | _(unset)_ | Native options passed unchanged to Sharp's `.avif()` method |

### Native Sharp output options

`webpOptions` and `avifOptions` accept the same native option objects as Sharp's
[`webp()` and `avif()` output methods](https://sharp.pixelplumbing.com/api-output/).
The plugin passes these objects to Sharp unchanged and does not define its own compression
defaults.

```js
convertImages({
  webpOptions: {
    quality: 82,
    effort: 5,
    smartSubsample: true,
  },
  avifOptions: {
    quality: 48,
    effort: 4,
    chromaSubsampling: '4:2:0',
  },
})
```

This makes an existing direct Sharp setup easy to migrate:

```js
// Direct Sharp usage:
await sharp(input).webp(webpOptions).toFile(target)

// Equivalent plugin configuration:
convertImages({ webpOptions })
```

Both fields are optional. When omitted, Sharp uses its own defaults, preserving the
plugin's previous output behavior. The exact available properties follow the installed
supported Sharp version.

The migration covers Sharp's WebP/AVIF output-method options only. Arbitrary pipeline
operations such as `resize()`, `rotate()`, `flatten()`, or metadata transforms are not
part of these configuration objects.

Existing targets are still skipped. If you change an option and want to regenerate an
already-created `.webp` or `.avif`, delete that target file and let the initial pass or
watcher create it again. A standalone `.webp` source is not re-encoded as WebP, so only
`avifOptions` applies to its generated AVIF sibling.

## Path Resolution

- Absolute paths are used as-is.
- Relative paths are resolved from Vite `root`.
- Paths that start with the configured public directory name, for example `public/img`, are resolved from the parent of the effective `publicDir` — the `publicDir` option if set, otherwise Vite's own detected `publicDir`.

This keeps the plugin compatible with standard Vite apps. In frameworks like Nuxt,
where Vite's own `publicDir` is always `false`, set the `publicDir` option explicitly
to keep `public/...` paths working — see [Nuxt Support](#nuxt-support).

At startup, the plugin logs each configured folder next to its resolved absolute path,
and warns if a resolved folder doesn't exist on disk — use this to verify resolution
before relying on the initial pass.

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
- Nuxt projects powered by Vite, including `srcDir` setups (set the `publicDir` option, see [Nuxt Support](#nuxt-support))
- Chokidar `3.5.3+`, `4.x`, and `5.x`
- Sharp `0.32+`, `0.33+`, `0.34+`, and `0.35+`
- Node `20.19+`, regardless of which supported Vite major you use

The plugin declares `"engines": { "node": ">=20.19.0" }` unconditionally, so this Node
requirement applies even if your project uses an older Vite major (`4.x`-`6.x`) that
itself supports lower Node versions.

## Logging

Dev output goes through Vite's own logger, so it respects Vite's `logLevel` and
`clearScreen` settings (for example, `logLevel: 'silent'` suppresses the plugin's logs
while conversions still run). Every top-level message is prefixed with
`[vite-webp-avif-generator]`; per-format lines (`WEBP`/`AVIF`) are indented and
intentionally left unprefixed.

## Notes

- The plugin is intentionally dev-only.
- The main conversion flow is file-system based and does not transform Vite modules.
- If you change runtime behavior, update the runtime file, typings, and README together.
