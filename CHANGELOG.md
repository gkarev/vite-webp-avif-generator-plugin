# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [2.2.3] - 2026-07-04

### Added
- One-time idempotent initial conversion pass for images already present in watched folders on dev server start, controlled by the new `enableInitialPass` option (default `true`).
- Recursive, symlink-safe file listing for the initial pass, with an internal concurrency limit for conversions.

### Changed
- Converted images are now written atomically (temp file + rename), preventing partial target files if the process is interrupted mid-write. Applies to both live and initial-pass conversions.
- The initial conversion pass now waits for the file watcher's `ready` event before starting, narrowing the window in which files added right after server start could be missed by both the live watcher and the initial pass.

### Fixed
- Closed the file watcher by wrapping each dev server instance's own `close()` method instead of `server.httpServer.once("close", ...)`, fixing a leak in Vite middleware-mode setups (such as Nuxt) where `server.httpServer` is `null` and the previous cleanup never ran. This supersedes the `[2.2.1]` fix below, which only addressed the standard (non-middleware) case.
- Fixed a watcher leak affecting real Nuxt projects: Nuxt runs two independent Vite dev servers (client build and server/SSR build) from the same `convertImages()` plugin instance passed via `nuxt.config.ts`. Cleanup state (the watcher and its idempotency flag) is now local to each `configureServer(server)` call instead of shared across the plugin instance, so closing one server's watcher can no longer overwrite or leak the other's — verified against real `nuxi dev` runs on Nuxt 3.21.8 and 4.4.8, including config-triggered restarts. This also removes a narrower, previously-documented edge case with Vite's own `server.restart()` reusing inline plugin instances.
- Errors thrown by `watcher.close()` are now caught and logged instead of propagating, so a failed close no longer blocks the rest of the dev server shutdown sequence.

## [2.2.1] - 2026-04-02

### Fixed
- Kept the image watcher alive for the whole Vite dev server lifecycle by closing it on the HTTP server `close` event instead of using the `configureServer` return hook.

### Verified
- Confirmed dev-mode behavior with Vite 5 and Vite 8, including `exclude` handling on real image files.

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
