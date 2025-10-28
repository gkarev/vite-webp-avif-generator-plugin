# Vite WebP & AVIF Generator Plugin

Production-ready Vite plugin for automatic image conversion to WebP and AVIF formats in dev mode.

## 🎯 Features

- ✅ Automatic image conversion when added to tracked folders
- ✅ Smart skipping of existing files for optimization
- ✅ Parallel image processing
- ✅ Detailed logging of all operations
- ✅ Configurable folders for tracking and exclusions
- ✅ Optional AVIF conversion

## 📦 Installation

```bash
npm install -D vite-webp-avif-generator sharp chokidar
```

**Requirements:**

- Node.js >= 16
- Vite >= 4.0.0

## 🚀 Usage

### Basic Configuration

```javascript
// vite.config.js
import { defineConfig } from "vite";
import convertImages from "vite-webp-avif-generator-plugin";

export default defineConfig({
  plugins: [
    convertImages() // Default settings
  ]
});
```

### Advanced Configuration

```javascript
convertImages({
  folders: ["src/img", "public/img"], // Folders to watch
  exclude: ["src/img/ignore"], // Folders to exclude
  enableAvif: true // Enable AVIF conversion
});
```

## ⚙️ Configuration

| Parameter    | Type       | Default                     | Description            |
| ------------ | ---------- | --------------------------- | ---------------------- |
| `folders`    | `string[]` | `['src/img', 'public/img']` | Folders to watch       |
| `exclude`    | `string[]` | `[]`                        | Folders to exclude     |
| `enableAvif` | `boolean`  | `true`                      | Enable AVIF conversion |

## 📸 Supported Formats

### Input Formats

- `.jpg` / `.jpeg`
- `.png`
- `.webp`

### Output Formats

- **WebP**: Generated only if source is NOT webp
- **AVIF**: Generated always (if `enableAvif: true`)

## 🔄 How It Works

### On File Addition

1. File format is checked (must be jpg/jpeg/png/webp)
2. File location is verified (in watched folder, not excluded)
3. Generated files are skipped
4. Convert to WebP (if source is not webp)
5. Convert to AVIF (if `enableAvif: true`)
6. Skip conversion if target file already exists

## 📁 File Structure Examples

### Source File: `src/img/photo.jpg`

```
src/img/
  ├── photo.jpg       # Original
  ├── photo.webp      # Auto-generated
  └── photo.avif      # Auto-generated
```

### Source File: `src/img/image.webp`

```
src/img/
  ├── image.webp      # Original
  └── image.avif      # Auto-generated (WebP skipped)
```

## 🎨 Logging Examples

### Successful Conversion

```
📸 [Image Converter] New file detected: src/img/photo.jpg
   ✓ WEBP: converted in 145ms
   ✓ AVIF: converted in 312ms
✅ Successfully converted: 2 format(s)
```

### Skipping Existing File

```
📸 [Image Converter] New file detected: src/img/photo.jpg
   ⏭️  WEBP: file already exists, skipping
   ⏭️  AVIF: file already exists, skipping
```

## 🔧 Technical Details

### Architecture

The plugin uses a clean modular architecture:

- **Main function**: `convertImages()` - plugin export
- **Event handlers**:
  - `handleFileAdd()` - handles file additions
- **Conversion utilities**:
  - `convertImage()` - converts to specified format
- **Helper functions**:
  - `isInExcludedFolder()` - checks exclusions
  - `isGeneratedFile()` - checks if file is generated
  - `getTargetPath()` - gets target file path
  - `getRelativePath()` - gets relative path

### Optimizations

1. **Skip existing files**: Already converted files are skipped
2. **Parallel processing**: WebP and AVIF are converted simultaneously
3. **Smart generated file detection**: Prevents infinite conversion loops
4. **Ignore initial files**: Existing files are not processed on startup

### Error Handling

- All operations are wrapped in try-catch blocks
- Errors are logged via `console.error` with detailed description
- One file error doesn't stop processing of other files
- Promise.allSettled used for parallel operations

## 💡 Best Practices

1. **Use high-quality originals**: Plugin creates optimized versions
2. **Add to .gitignore**: Generated files can be ignored
3. **Use with ViteImageOptimizer**: For additional production optimization
4. **Configure exclude**: For temporary file folders

## 🛠️ Compatibility

- **Vite**: 4.x, 5.x, 6.x, 7.x
- **Node.js**: 16+
- **Sharp**: 0.32+
- **Chokidar**: 3.x, 4.x

## 📝 License

MIT

## 🤝 Contributing

This plugin is developed as a production-ready solution with emphasis on:

- Performance
- Reliability
- Ease of use
- Code quality
