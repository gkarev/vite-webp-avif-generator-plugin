# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.2.0] - 2026-04-01

### Changed
- Added Vite 8 peer dependency support.
- Scoped the plugin to dev server mode with `apply: "serve"`.
- Switched path normalization to Vite `normalizePath`.
- Moved watcher cleanup to the official `configureServer` return cleanup.
- Made path comparisons case-insensitive only on Windows.
- Added support for `public/...` paths when `publicDir` lives outside Vite `root`.
- Made `exclude` resolution follow the same rules as watched folders.
- Improved compatibility for Nuxt setups that use `srcDir` while keeping assets in the project-level `public/` directory.

### Documentation
- Updated README with explicit Nuxt support notes and `srcDir` usage guidance.
- Refreshed compatibility notes for Vite 4-8 and modern Node runtimes.

## [1.0.0] - 2024-10-28

### Added
- Initial release of the plugin.
- Automatic image conversion to WebP.
- Automatic image conversion to AVIF.
- Chokidar-based file watcher for new files.
- Configurable folders to watch.
- Excluded folder support.
- Optional AVIF generation.
- Parallel WebP and AVIF processing.
- Generated file detection to avoid conversion loops.
- Detailed logging.
- TypeScript declaration file.
- Cross-platform path handling support.
