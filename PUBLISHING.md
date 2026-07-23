# Publishing

## Pre-publish verification

Run from the repository root after `npm install`:

```bash
npm run verify
```

Expected:

- syntax check exits with code `0`;
- `test-format-options.mjs` reports `17/17 passed`;
- `test-output-naming.mjs` reports `15/15 passed`;
- `test-active-work-cleanup.mjs` reports `4/4 passed`;
- `run-tests.mjs` reports all checks passed;
- logging reports `18/18 passed`, watcher cleanup reports `6/6 passed`, and race reports `4/4 passed`;
- both Nuxt-focused scripts exit with code `0`;
- `npm audit --omit=dev` reports no production vulnerabilities;
- `npm pack --dry-run --ignore-scripts` lists only the published allowlist files.

`run-tests.mjs` and `test-race-initial-pass.mjs` modify playground fixtures. Run them in a
clean worktree or restore playground state afterward if you need a pristine checkout.

## Publish steps

1. Install dependencies:
   `npm install`

2. Run `npm run verify`.

3. Check the package contents:
   `npm pack --dry-run --ignore-scripts`

4. Log in to npm:
   `npm login`

5. Publish the package:
   `npm publish`

6. If needed, verify the published version:
   `npm view vite-webp-avif-generator-plugin version`
