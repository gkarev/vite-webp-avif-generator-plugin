# Vite WebP & AVIF Generator Plugin

Automatically generate WebP and AVIF versions of project images while the Vite
or Nuxt dev server is running:

```text
photo.jpg -> photo.webp + photo.avif
```

Generated sidecar files are written next to their sources, remain visible and
reviewable, and are ready to commit to Git.

## Who Is It For?

Use this plugin when your team:

- keeps images in project folders such as `src/img` or `public/img`;
- wants generated WebP/AVIF files to be regular version-controlled assets;
- prefers predictable filenames over import queries or framework components;
- wants conversion to happen during development instead of production builds.

The plugin creates files only. It does not rewrite imports, HTML, or application
code, so your application must reference the generated files explicitly.

## Installation

```bash
npm install -D vite-webp-avif-generator-plugin
```

Sharp and Chokidar are installed automatically as regular dependencies.

## Minimal Configuration

```js
// vite.config.js
import { defineConfig } from 'vite'
import convertImages from 'vite-webp-avif-generator-plugin'

export default defineConfig({
  plugins: [convertImages()],
})
```

The default configuration:

- watches `src/img` and `public/img`;
- generates WebP and AVIF;
- processes existing images once when the dev server starts;
- uses Sharp's native output defaults.

## Using Generated Files

The plugin creates the image files but leaves delivery and fallback markup under
your control. The example below assumes the files are generated in `public/img`.
Files under `src` must be imported through Vite as usual.

```html
<picture>
  <source srcset="/img/photo.avif" type="image/avif">
  <source srcset="/img/photo.webp" type="image/webp">
  <img src="/img/photo.jpg" alt="">
</picture>
```

## Adding to an Existing Project

On the first `npm run dev`, the enabled initial pass scans the configured folders
recursively and creates every missing WebP/AVIF target next to its source. In a
project with many existing images, this can add many new files to the working tree
and temporarily use noticeable CPU.

Before the first run:

1. Start with a clean Git working tree.
2. Review `folders` and `exclude`.
3. Choose `outputNaming` before generating files. Use `'preserve'` when same-name
   sources such as `logo.jpg` and `logo.png` may share a directory.
4. Start the dev server, review the conversion summary and generated images, then
   commit the accepted sidecar files.

Existing WebP/AVIF targets are skipped without checking whether they are current.
To regenerate them after changing a source or Sharp option, delete the targets and
restart the dev server. Set `enableInitialPass: false` when only files added after
startup should be processed.

## Why Dev Mode?

The plugin intentionally runs only with the Vite dev server (`apply: 'serve'`).

- Developers see conversion errors immediately.
- Generated assets can be inspected and committed with their sources.
- Production builds do not run Sharp or modify the source tree.
- CI and deployment do not need to regenerate already committed images.
- The plugin does not transform Vite modules or add browser runtime code.

Use a build-time optimizer instead when generated images should exist only inside
`dist` and should not be committed to the repository.

## Full Configuration

```js
// vite.config.js
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import convertImages from 'vite-webp-avif-generator-plugin'

export default defineConfig({
  plugins: [
    convertImages({
      folders: ['src/img', 'public/img'],
      exclude: ['src/img/ignored', 'public/img/ignored'],
      enableAvif: true,
      enableInitialPass: true,
      outputNaming: 'preserve',

      // Optional in standard Vite. Set explicitly for public/... paths in Nuxt.
      publicDir: resolve(process.cwd(), 'public'),

      // Passed unchanged to sharp().webp().
      webpOptions: {
        quality: 82,
        effort: 5,
        smartSubsample: true,
      },

      // Passed unchanged to sharp().avif().
      avifOptions: {
        quality: 48,
        effort: 4,
        chromaSubsampling: '4:2:0',
      },
    }),
  ],
})
```

## Nuxt

Nuxt exposes Vite's `publicDir` as `false`. When watching `public/...` paths,
set the plugin's `publicDir` explicitly:

```ts
// nuxt.config.ts
import { resolve } from 'node:path'
import convertImages from 'vite-webp-avif-generator-plugin'

export default defineNuxtConfig({
  vite: {
    plugins: [
      convertImages({
        folders: ['src/img', 'public/img'],
        publicDir: resolve(process.cwd(), 'public'),
        outputNaming: 'preserve',
      }),
    ],
  },
})
```

This is especially important when Nuxt uses a custom `srcDir`. At startup, the
plugin logs every configured folder next to its resolved path and warns when a
watched folder does not exist. If the initial pass reports `processed 0`, check
these paths first.

With a custom Nuxt `srcDir`, configure non-public source folders relative to that
directory. For example, use `assets/img` when `srcDir` is `./src` and the physical
folder is `src/assets/img`.

Nuxt runs separate Vite client and SSR dev servers. The plugin manages their
watchers independently and closes them on shutdown or restart.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `folders` | `string[]` | `['src/img', 'public/img']` | Folders to watch recursively |
| `exclude` | `string[]` | `[]` | Folders excluded from conversion |
| `enableAvif` | `boolean` | `true` | Generate AVIF files |
| `enableInitialPass` | `boolean` | `true` | Process existing files once on dev server startup |
| `outputNaming` | `'replace' \| 'preserve'` | `'replace'` | Replace or preserve the source extension in generated names |
| `publicDir` | `string` | unset | Explicit public directory for `public/...` paths |
| `webpOptions` | `import('sharp').WebpOptions` | unset | Native options passed to `sharp().webp()` |
| `avifOptions` | `import('sharp').AvifOptions` | unset | Native options passed to `sharp().avif()` |

See Sharp's
[`webp()` and `avif()` documentation](https://sharp.pixelplumbing.com/api-output/)
for the supported output options. Arbitrary Sharp pipeline operations such as
`resize()`, `rotate()`, or metadata transforms are not accepted here.

## Supported Formats

| Source | Generated output |
| --- | --- |
| `.jpg`, `.jpeg`, `.png` | WebP and optional AVIF |
| `.webp` | Optional AVIF only |

SVG is not supported and SVG files are ignored. Use a dedicated SVGO-based Vite
plugin when you need SVG minification or optimization.

## Important Behavior

### Existing targets

Existing targets are never overwritten. To apply source or Sharp option changes,
delete the generated targets and restart the dev server.

### Output names and collisions

The default `outputNaming: 'replace'` creates:

```text
logo.png -> logo.webp + logo.avif
```

Distinct `logo.png` and `logo.jpg` sources therefore collide. The initial pass
reports this and recommends collision-safe naming:

```js
convertImages({ outputNaming: 'preserve' })
```

```text
logo.png -> logo.png.webp + logo.png.avif
logo.jpg -> logo.jpg.webp + logo.jpg.avif
hero.webp -> hero.webp.avif
```

`replace` remains the default for backward compatibility with existing asset URLs.

### Initial pass and live watching

The watcher starts before the recursive initial pass, so startup additions are not
missed. Processing uses bounded concurrency, ignores symlinks, deduplicates
overlapping folders, and skips existing targets without invoking Sharp. Set
`enableInitialPass: false` to process only new files.

### Atomic output and interrupted conversions

Each result is staged beside its target:

```text
image.webp.vite-webp-avif-generator.a1b2c3d4e5f60708.incomplete
```

The file is renamed only after Sharp succeeds. An `.incomplete` file left by an
abrupt interruption is diagnostic and must not be committed as an image. Startup
cleanup removes only exact plugin-owned files older than 24 hours; fresh, foreign,
excluded, and symlinked entries are preserved. Shutdown waits for registered work.

## Path Resolution

- Absolute paths are used as-is.
- Relative paths are resolved from Vite `root`.
- Paths beginning with the configured public directory name are resolved from the
  parent of the effective `publicDir`.

All plugin output goes through Vite's logger and respects `logLevel` and
`clearScreen`.

## Scope

The plugin does not provide:

- build-time image optimization;
- resizing, `srcset`, or LQIP generation;
- SVG optimization;
- CDN delivery or runtime transformations;
- import-query or framework-component integration.

## Compatibility

- Node `20.19+`
- Vite `4.x` through `8.x`
- Nuxt projects powered by Vite, including custom `srcDir` setups
- Sharp `0.35+`
- Chokidar `3.5.3+`, `4.x`, and `5.x`
