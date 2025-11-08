# 🖼️ Vite WebP & AVIF Generator Plugin

> Production-ready Vite plugin for automatic image conversion to modern WebP and AVIF formats with real-time file watching

**The Problem:** Modern image formats (WebP, AVIF) provide 30-50% better compression than JPG/PNG, but manually converting every image is tedious. Most image optimization tools only work at build time, forcing you to rebuild just to test converted images.

**The Solution:** This plugin works in **dev mode** and converts images **instantly**. Drop a JPG into your project → WebP & AVIF versions appear in seconds. Use them immediately in your HTML/CSS without waiting for a build. Real-time conversion during development, automatic optimization for production.

[![npm version](https://img.shields.io/npm/v/vite-webp-avif-generator-plugin.svg)](https://www.npmjs.com/package/vite-webp-avif-generator-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Vite](https://img.shields.io/badge/Vite-4%20%7C%205%20%7C%206%20%7C%207-646CFF?logo=vite)](https://vitejs.dev/)

## Features

- **Auto-conversion** - Real-time WebP & AVIF generation
- **File watching** - Detects new images instantly
- **Parallel processing** - Fast concurrent conversions
- **Smart skip** - Avoids re-converting existing files
- **Security** - Path traversal protection (v2.0+)
- **Performance** - Async operations, non-blocking
- **Configurable** - Flexible folder tracking and exclusions
- **Dev-focused** - Optimized for development workflow

## Installation

```bash
npm install -D vite-webp-avif-generator-plugin sharp chokidar
```

**Requirements:**

- **Node.js:** 16.0.0+
- **Vite:** 4.x, 5.x, 6.x, 7.x
- **Sharp:** 0.32.0+
- **Chokidar:** 3.x, 4.x

## Quick Start

### 1. Configure Vite

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import convertImages from 'vite-webp-avif-generator-plugin';

export default defineConfig({
  plugins: [
    convertImages() // Default settings
  ]
});
```

### 2. Add Images

Place images in your tracked folders:

```
project/
├── src/
│   └── img/
│       └── photo.jpg          ← Add your image
└── vite.config.js
```

### 3. Start Dev Server

```bash
npm run dev
```

**Result:**

```
src/img/
├── photo.jpg                  ← Original
├── photo.webp                 ← Auto-generated ✨
└── photo.avif                 ← Auto-generated ✨
```

## Configuration

```typescript
interface ConvertImagesOptions {
  folders?: string[];       // Default: ['src/img', 'public/img']
  exclude?: string[];       // Default: []
  enableAvif?: boolean;     // Default: true
}
```

### Basic Example

```javascript
convertImages({
  folders: ['src/img', 'public/img'],
  enableAvif: true
})
```

### Advanced Example

```javascript
convertImages({
  folders: ['src/images', 'public/photos', 'assets/gallery'],
  exclude: ['src/images/ignore', 'assets/gallery/temp'],
  enableAvif: true  // Generate both WebP and AVIF
})
```

### Disable AVIF

```javascript
convertImages({
  folders: ['src/img'],
  enableAvif: false  // WebP only
})
```

## Options

| Parameter | Type | Default | Description |
| ------------ | ---------- | --------------------------- | ------------------------------- |
| `folders` | `string[]` | `['src/img', 'public/img']` | Folders to watch for images |
| `exclude` | `string[]` | `[]` | Folders to exclude from watch |
| `enableAvif` | `boolean` | `true` | Enable AVIF format conversion |
| **`webpOptions`** | `object` | `{ quality: 80, lossless: false, effort: 4 }` | WebP quality settings |
| **`avifOptions`** | `object` | `{ quality: 75, lossless: false, effort: 4 }` | AVIF quality settings |
| **`verbose`** | `boolean` | `true` | Enable detailed logging |

### Quality Control Options

#### webpOptions

| Property | Type | Range | Default | Description |
|----------|------|-------|---------|-------------|
| `quality` | `number` | 0-100 | `80` | Output image quality (higher = better quality, larger size) |
| `lossless` | `boolean` | - | `false` | Use lossless compression (perfect quality, ~2x size) |
| `effort` | `number` | 0-6 | `4` | Compression effort (higher = better compression, slower) |

#### avifOptions

| Property | Type | Range | Default | Description |
|----------|------|-------|---------|-------------|
| `quality` | `number` | 0-100 | `75` | Output image quality (AVIF is more efficient than WebP) |
| `lossless` | `boolean` | - | `false` | Use lossless compression (perfect quality, ~2x size) |
| `effort` | `number` | 0-9 | `4` | Compression effort (higher = better compression, slower) |

### Quality Control Examples

#### High Quality
```javascript
convertImages({
  folders: ['src/img'],
  webpOptions: { 
    quality: 90,    // Excellent quality
    effort: 6       // Maximum compression effort
  },
  avifOptions: { 
    quality: 85,    // Excellent quality
    effort: 7       // Maximum compression effort
  }
})
```

**Result:** Beautiful images, ~20% larger files, slower conversion

#### Balanced (Default)
```javascript
convertImages({
  folders: ['src/img'],
  webpOptions: { quality: 80 },  // Default
  avifOptions: { quality: 75 }   // Default
})
```

**Result:** Great quality, optimal size, good speed

#### Maximum Compression
```javascript
convertImages({
  folders: ['src/img'],
  webpOptions: { quality: 70, effort: 6 },
  avifOptions: { quality: 65, effort: 9 }
})
```

**Result:** Good quality, ~30% smaller files, fast conversion

#### Lossless (Perfect Quality)
```javascript
convertImages({
  folders: ['src/img'],
  webpOptions: { lossless: true },
  avifOptions: { lossless: true }
})
```

**Result:** Perfect quality, ~100% larger files, very slow

#### Silent Mode
```javascript
convertImages({
  folders: ['src/img'],
  verbose: false  // Only show errors
})
```

**Result:** Clean console output in production

### Quality Comparison Table

| Setting | WebP Size | AVIF Size | Quality | Speed |
|---------|-----------|-----------|---------|-------|
| `quality: 70` | **-30%** 📉 | **-35%** 📉 | Good ⭐⭐⭐ | Fast ⚡ |
| `quality: 80` (default) | Baseline | Baseline | Excellent ⭐⭐⭐⭐ | Medium ⚡⚡ |
| `quality: 90` | **+20%** 📈 | **+25%** 📈 | Outstanding ⭐⭐⭐⭐⭐ | Slow ⚡⚡⚡ |
| `lossless: true` | **+100%** 📈📈 | **+120%** 📈📈 | Perfect ⭐⭐⭐⭐⭐ | Very Slow ⚡⚡⚡⚡ |

## Supported Formats

### Input Formats

| Format | Extensions | Notes |
|--------|-----------|-------|
| JPEG | `.jpg`, `.jpeg` | Most common format |
| PNG | `.png` | Lossless format |
| WebP | `.webp` | Modern format |

### Output Formats

| Format | Generated When | Browser Support |
|--------|---------------|-----------------|
| **WebP** | Source is NOT `.webp` | 97%+ (Chrome, Firefox, Safari, Edge) |
| **AVIF** | Always (if enabled) | 87%+ (Chrome, Firefox, Safari 16+) |

### Conversion Logic

```javascript
// Example: photo.jpg
photo.jpg → photo.webp  ✅ (source is not webp)
photo.jpg → photo.avif  ✅ (enableAvif: true)

// Example: image.webp
image.webp → image.webp  ⏭️ (skip, already webp)
image.webp → image.avif  ✅ (enableAvif: true)
```

## How It Works

### Conversion Flow

1. **File Detection** - Chokidar watches configured folders
2. **Validation** - Checks format (jpg/jpeg/png/webp)
3. **Location Check** - Verifies file is in tracked, non-excluded folder
4. **Generated Check** - Skips already generated files
5. **WebP Conversion** - If source is not `.webp`
6. **AVIF Conversion** - If `enableAvif: true`
7. **Skip Existing** - Avoids re-converting if target exists

### Real-Time Watching

```bash
Dev Server Running...

# You add: src/img/photo.jpg
📸 New file detected: src/img/photo.jpg
   ✓ WEBP: converted in 145ms
   ✓ AVIF: converted in 312ms
✅ Successfully converted: 2 format(s)

# Files now exist:
# src/img/photo.jpg
# src/img/photo.webp  ← Generated
# src/img/photo.avif  ← Generated
```

## Key Features

### Auto-Conversion

Add an image → Get modern formats instantly:

```
Before:
src/img/
  └── photo.jpg

After (automatic):
src/img/
  ├── photo.jpg       ← Original
  ├── photo.webp      ← Generated
  └── photo.avif      ← Generated
```

### Smart Skip

Already converted? Plugin skips:

```
📸 New file detected: src/img/photo.jpg
   ⏭️  WEBP: already exists, skipping
   ⏭️  AVIF: already exists, skipping
```

### Parallel Processing

WebP and AVIF convert simultaneously:

```
Converting photo.jpg...
  ├─ WebP conversion (145ms) ⚡
  └─ AVIF conversion (312ms) ⚡
Total: 312ms (not 145 + 312 = 457ms)
```

### Security (v2.0+)

Path validation prevents attacks:

```javascript
// ❌ Blocked - outside project
convertImages({
  folders: ['../../../etc']
})
// Error: Security: folder is outside project root

// ✅ Safe - inside project
convertImages({
  folders: ['src/img']
})
```

### Logging

Detailed console output:

```
✅ Success:
📸 [Image Converter] New file detected: src/img/photo.jpg
   ✓ WEBP: converted in 145ms
   ✓ AVIF: converted in 312ms
✅ Successfully converted: 2 format(s)

⏭️ Skip:
📸 [Image Converter] New file detected: src/img/photo.jpg
   ⏭️  WEBP: already exists, skipping
   ⏭️  AVIF: already exists, skipping

❌ Error:
📸 [Image Converter] New file detected: src/img/photo.jpg
   ❌ Error converting to WEBP: Invalid image format
```

## Use Cases

### Development Workflow

```javascript
// 1. Configure plugin
export default defineConfig({
  plugins: [convertImages()]
});

// 2. Add image to project
// src/img/hero.jpg

// 3. Use in HTML with <picture>
```

```html
<picture>
  <source srcset="/src/img/hero.avif" type="image/avif">
  <source srcset="/src/img/hero.webp" type="image/webp">
  <img src="/src/img/hero.jpg" alt="Hero">
</picture>
```

**Result:** 
- Best format loaded based on browser support
- Fallback to original JPG for older browsers

### Multi-Folder Projects

```javascript
convertImages({
  folders: [
    'src/images',           // UI images
    'public/photos',        // User photos
    'assets/gallery'        // Gallery images
  ],
  exclude: [
    'assets/gallery/temp'   // Temporary files
  ]
})
```

### WebP-Only Mode

```javascript
// For smaller file sizes, disable AVIF
convertImages({
  folders: ['src/img'],
  enableAvif: false  // Only generate WebP
})
```

## Advanced

### Architecture

Clean modular design:

```
convertImages()                    Main plugin export
  ├─ configureServer()            Vite hook
  │   └─ setupFileWatcher()       Chokidar setup
  │       └─ handleFileAdd()      File add handler
  │           ├─ validateFile()   Format & path checks
  │           ├─ convertImage()   Sharp conversion
  │           └─ fileExists()     Skip check
  └─ Helper utilities:
      ├─ isInExcludedFolder()    Exclusion check
      ├─ isGeneratedFile()       Generated check
      ├─ getTargetPath()         Target path
      └─ getRelativePath()       Relative path
```

### Optimizations

| Optimization | Implementation | Benefit |
|-------------|----------------|---------|
| **Skip existing** | Check before convert | Avoids duplication |
| **Parallel processing** | `Promise.allSettled()` | 2x faster |
| **Generated detection** | Track created files | No infinite loops |
| **Ignore on startup** | `ignoreInitial: true` | Fast dev start |
| **Async operations** | `fs/promises` | Non-blocking |

### Error Handling

```javascript
try {
  // Convert image
  await convertImage(file, 'webp');
} catch (error) {
  // Log error, continue processing other files
  console.error(`❌ Error converting ${file}:`, error);
  // Other files still process ✅
}

// Parallel with graceful failures
await Promise.allSettled([
  convertToWebP(),  // May fail
  convertToAVIF()   // Still runs
]);
```

### Integration

#### With HTML

```html
<!-- Modern browsers: AVIF -->
<!-- Safari 14-16: WebP -->
<!-- Old browsers: JPG -->
<picture>
  <source srcset="photo.avif" type="image/avif">
  <source srcset="photo.webp" type="image/webp">
  <img src="photo.jpg" alt="Photo">
</picture>
```

#### With React

```jsx
export function ResponsiveImage({ src, alt }) {
  const base = src.replace(/\.[^.]+$/, '');
  const ext = src.split('.').pop();
  
  return (
    <picture>
      <source srcSet={`${base}.avif`} type="image/avif" />
      <source srcSet={`${base}.webp`} type="image/webp" />
      <img src={src} alt={alt} />
    </picture>
  );
}

// Usage
<ResponsiveImage src="/img/hero.jpg" alt="Hero" />
```

#### With CSS

```css
/* Fallback */
.hero {
  background-image: url('/img/hero.jpg');
}

/* WebP support */
.webp .hero {
  background-image: url('/img/hero.webp');
}

/* AVIF support */
.avif .hero {
  background-image: url('/img/hero.avif');
}
```

## Best Practices

### 1. Use High-Quality Originals

```javascript
// ✅ Good: High-quality source
// 4000x3000 JPEG (95% quality) → Optimized WebP/AVIF

// ❌ Bad: Already compressed source
// 1000x750 JPEG (60% quality) → Poor quality WebP/AVIF
```

### 2. Add Generated Files to `.gitignore`

```gitignore
# .gitignore
*.webp
*.avif

# Keep originals only
!src/img/*.jpg
!src/img/*.png
```

### 3. Configure Exclusions

```javascript
convertImages({
  folders: ['src/img', 'public/photos'],
  exclude: [
    'src/img/temp',        // Temporary files
    'public/photos/cache'  // Cache folder
  ]
})
```

### 4. Combine with Production Optimizer

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import convertImages from 'vite-webp-avif-generator-plugin';
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer';

export default defineConfig({
  plugins: [
    convertImages(),           // Dev: Generate formats
    ViteImageOptimizer()       // Build: Optimize all images
  ]
});
```

## Performance

### Conversion Speed

| Image | Size | WebP | AVIF | Total |
|-------|------|------|------|-------|
| 4K Photo | 3.2 MB | 145ms | 312ms | 312ms ⚡ |
| HD Photo | 1.8 MB | 89ms | 198ms | 198ms ⚡ |
| Thumbnail | 120 KB | 12ms | 28ms | 28ms ⚡ |

*Parallel processing: Total = max(WebP, AVIF), not sum*

### File Size Comparison

```
Original JPEG: 2.4 MB (100%)
WebP:          1.2 MB (50% smaller)
AVIF:          890 KB (63% smaller)
```

### Browser Support Impact

```
AVIF support:  87% of users → 890 KB
WebP support:  97% of users → 1.2 MB
JPEG fallback: 100% of users → 2.4 MB

Average delivered: ~1.1 MB (54% savings)
```

## Compatibility

- **Vite:** 4.x, 5.x, 6.x, 7.x
- **Node.js:** 16.0.0+
- **Sharp:** 0.32.0+, 0.33.0, 0.34.0
- **Chokidar:** 3.x, 4.x
- **TypeScript:** Full support
- **OS:** Windows, macOS, Linux

## Migration Guide

### From v1.x to v2.0

**Breaking Changes:**
1. Path validation - Folders must be inside project
2. Async operations - Internal async refactor (no API changes)

**If using standard paths - no changes needed:**

```javascript
// ✅ Works the same
convertImages({
  folders: ['src/img', 'public/img']
})
```

**If using paths outside project - now blocked:**

```javascript
// ❌ v1.x - worked (vulnerability!)
convertImages({
  folders: ['../../../etc']
})

// ✅ v2.0 - throws error with explanation
// Error: Security: folder is outside project root
```

See [CHANGELOG.md](./CHANGELOG.md) for details.

## Troubleshooting

### Images not converting?

1. Check folders are configured correctly
2. Verify file formats (jpg/jpeg/png/webp only)
3. Check console for errors
4. Ensure Sharp is installed: `npm list sharp`

### Permission errors?

```bash
# Windows: Run as administrator
# macOS/Linux: Check folder permissions
chmod 755 src/img
```

### Sharp installation issues?

```bash
# Rebuild Sharp
npm rebuild sharp

# Or reinstall
npm uninstall sharp
npm install -D sharp
```

## Links

- [npm Package](https://www.npmjs.com/package/vite-webp-avif-generator-plugin)
- [GitHub Repository](https://github.com/gkarev/vite-webp-avif-generator-plugin)
- [Issues](https://github.com/gkarev/vite-webp-avif-generator-plugin/issues)
- [Changelog](./CHANGELOG.md)
- [Sharp Documentation](https://sharp.pixelplumbing.com/)
- [Chokidar Documentation](https://github.com/paulmillr/chokidar)

## Related Resources

- [WebP vs AVIF Comparison](https://developers.google.com/speed/webp)
- [Can I Use WebP](https://caniuse.com/webp)
- [Can I Use AVIF](https://caniuse.com/avif)

## License

MIT © [Karev G.S.](https://github.com/gkarev)

---

**Made with ❤️ for the Vite ecosystem**
