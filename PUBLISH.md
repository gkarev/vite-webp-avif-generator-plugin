# 📦 NPM Publication Guide

## Prerequisites

1. **NPM account**
   - Register at https://www.npmjs.com/signup
   - Verify email

2. **Login to npm**
   ```bash
   npm login
   ```

3. **Check version**
   ```bash
   node --version  # v16.0.0+
   npm --version
   ```

## Pre-Publication Checklist

### 1. Update Version

Current version: **2.0.0**

```bash
npm version patch  # 2.0.0 → 2.0.1
npm version minor  # 2.0.0 → 2.1.0
npm version major  # 2.0.0 → 3.0.0
```

### 2. Verify Package Contents

Preview what will be published:
```bash
npm pack --dry-run
```

Files included (from `package.json`):
```json
"files": [
  "vite-webp-avif-generator-plugin.js",
  "vite-webp-avif-generator-plugin.d.ts",
  "README.md",
  "CHANGELOG.md",
  "LICENSE"
]
```

### 3. Test Locally

```bash
# Create package
npm pack

# Install in test project
npm install ../path/to/vite-webp-avif-generator-plugin-2.0.0.tgz
```

### 4. Update Documentation

- [ ] CHANGELOG.md updated
- [ ] README.md reviewed
- [ ] Version bumped in package.json
- [ ] All changes committed

## Publish

### Standard Publication

```bash
npm publish
```

### With 2FA (Recommended)

```bash
npm publish --otp=123456
```

### Beta/Tag Publication

```bash
npm publish --tag beta
```

## Post-Publication

### 1. Verify Publication

Check package page:
https://www.npmjs.com/package/vite-webp-avif-generator-plugin

### 2. Create Git Tag

```bash
git tag v2.0.0
git push origin v2.0.0
```

### 3. Test Installation

```bash
npm install vite-webp-avif-generator-plugin
```

## Update Workflow

For future updates:

```bash
# 1. Make changes
# 2. Update CHANGELOG.md
# 3. Bump version
npm version patch

# 4. Publish
npm publish

# 5. Push tags
git push --tags
```

## Troubleshooting

### Check package info
```bash
npm info vite-webp-avif-generator-plugin
```

### List tokens
```bash
npm token list
```

### Unpublish (within 72 hours only)
```bash
npm unpublish vite-webp-avif-generator-plugin@2.0.0
```

## Security

Enable 2FA in npm settings:
https://www.npmjs.com/settings/[username]/tfa

## Quick Checklist

- [ ] `npm login` successful
- [ ] Version updated
- [ ] CHANGELOG.md updated
- [ ] README.md reviewed
- [ ] `npm pack --dry-run` verified
- [ ] Code tested locally
- [ ] Git committed
- [ ] Ready to publish

## Links

- [NPM Package](https://www.npmjs.com/package/vite-webp-avif-generator-plugin)
- [GitHub Repository](https://github.com/gkarev/vite-webp-avif-generator-plugin)
- [NPM Documentation](https://docs.npmjs.com/)
- [NPM Support](https://www.npmjs.com/support)

