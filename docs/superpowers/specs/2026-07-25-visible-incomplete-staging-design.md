# Visible incomplete staging: design specification

## 1. Goal

Preserve atomic image publication while making an interrupted conversion visible and
understandable to a developer.

The current implementation writes a random `*.tmp` file next to the target and renames
it after Sharp completes. This protects the final `.webp` or `.avif`, but a `SIGKILL`
can leave a cryptically named file behind. The existing regression test incorrectly
expects such a file to be removed even though `SIGKILL` does not allow process cleanup.

The revised contract is:

- a final target is either complete or absent;
- an interrupted transaction may leave an explicitly named diagnostic artifact;
- the artifact is intentionally visible in the working tree and must not be added to
  `.gitignore`;
- ordinary caught failures still attempt immediate cleanup;
- a later plugin startup removes only stale plugin-owned artifacts after a protective
  TTL.

## 2. Scope

In scope:

- a self-describing name for target-local staging files;
- precise handling of conversion, publication, and cleanup failures;
- stale plugin-owned artifact cleanup with a fixed 24-hour TTL;
- deterministic regression coverage for graceful failure and forced interruption;
- README and changelog synchronization.

Out of scope:

- moving staging files to Vite `cacheDir` or an operating-system temp directory;
- changing public plugin options or TypeScript declarations;
- handling source `change` and `unlink` events;
- changing `outputNaming` collision policy;
- guaranteeing storage durability after sudden power loss;
- claiming atomic semantics for network filesystems that do not provide normal local
  filesystem rename guarantees.

## 3. Staging filename

For target `image.webp`, the staging path has this shape:

```text
image.webp.vite-webp-avif-generator.<pid>.<random-id>.incomplete
```

Requirements:

- `.incomplete` is the final suffix, so Chokidar filtering, Vite, and asset tools do not
  treat the file as a supported image source;
- `vite-webp-avif-generator` identifies ownership for diagnostics and cleanup;
- the PID helps stale cleanup avoid a file owned by a live local process;
- `random-id` is 8 random bytes encoded as 16 lowercase hexadecimal characters;
- the intended final target remains readable at the start of the filename.

An `.incomplete` artifact means that publication did not complete. Its bytes may be
partial, complete, or absent depending on the exact interruption point; it must never
be consumed as a generated image.

## 4. Conversion and publication flow

```text
check final target
  -> create unique target-local .incomplete path
  -> Sharp writes the requested explicit format
  -> rename .incomplete to final target
  -> log converted
```

The staging file remains in the target directory. Therefore staging and target are on
the same filesystem, and the file receives the target directory's normal permission
and ACL inheritance.

Sharp is always configured with the explicit `webp` or `avif` output method. It does
not infer the format from the `.incomplete` suffix.

The final rename remains the publication boundary. Consumers must see either no final
target or the fully written result. The existing target-exists and output-collision
semantics remain unchanged by this work.

## 5. Failure model

| Failure | Required behavior |
| --- | --- |
| Sharp rejects the source or options | Mark the format failed, remove its `.incomplete` file best-effort, and allow the sibling format and Vite server to continue |
| Target directory is not writable (`EACCES`, `EPERM`, `EROFS`) | Log the operation, path, and error code; do not create or alter the final target |
| Disk or quota is exhausted (`ENOSPC`, `EDQUOT`) | Do not retry in a loop; attempt to remove partial staging to release space; leave the final target absent |
| File descriptor limit is reached (`EMFILE`, `ENFILE`) | Fail the individual format without an unhandled rejection; bounded initial-pass concurrency prevents an operation storm |
| The staging basename exceeds a filesystem limit (`ENAMETOOLONG`) | Fail the individual format with the target path in the diagnostic; do not silently shorten away the ownership or `.incomplete` marker |
| Source disappears (`ENOENT`) | Treat the stale watcher event as skipped, remove staging best-effort, and do not log a successful conversion |
| Target parent disappears (`ENOENT`) | Fail the individual format and do not recreate user directories automatically |
| Windows temporarily blocks publication (`EBUSY`, `EPERM`, `EACCES`) | After the initial failure, retry rename three times after 50, 100, and 200 ms; then fail normally |
| Immediate cleanup fails | Keep the `.incomplete` artifact and log its exact path instead of suppressing the cleanup error |
| Graceful server close | Stop the watcher, wait for registered conversion tasks, then complete Vite close |
| `SIGKILL` or process crash | Cleanup cannot run; the final target remains absent or complete, and the visible `.incomplete` artifact may remain |
| Stale-cleanup inspection or deletion fails | Warn through the Vite logger and continue startup, watching, and conversions |

There is no fallback to writing directly into the final target.

## 6. Stale cleanup

Cleanup runs when a watcher becomes ready, independently of `enableInitialPass`. When
the initial pass is enabled, stale cleanup finishes before that pass begins.

An entry is eligible only when all of the following are true:

1. It is a regular file and not a symbolic link.
2. Its basename exactly matches the plugin-owned staging pattern.
3. It is inside a resolved watched folder and outside current exclusions.
4. Its modification time is at least 24 hours old.
5. Its encoded owner PID is confirmed not to be alive locally.
6. Its path is not present in the current process's active staging set.

Safety rules:

- a future timestamp or clock ambiguity is treated as fresh;
- `EPERM` or an unknown PID-liveness result is treated as possibly alive;
- PID reuse causes a safe leak rather than deletion of a potentially active file;
- `ENOENT` during inspection or deletion is an expected cleanup race;
- foreign `.tmp`, `.incomplete`, malformed plugin-like files, directories, symlinks,
  and fresh plugin-owned files are never removed;
- overlapping watched folders are deduplicated before deletion;
- all cleanup inspection and deletion errors produce at most one aggregated warning per
  cleanup run.

The 24-hour TTL is an internal safety constant, not a new public option.

## 7. Git and developer experience

No `.gitignore` rule is added.

After an abnormal interruption, `git status` may intentionally show a path such as:

```text
image.webp.vite-webp-avif-generator.14320.a1b2c3d4e5f60708.incomplete
```

This is a diagnostic signal that an image transaction did not finish. README guidance
must tell the developer not to use or commit the file. A later startup removes it only
after it becomes stale and its owner is no longer alive.

Normal successful conversion and caught failures with successful cleanup leave the
working tree free of staging artifacts.

## 8. Logging

All messages use the Vite logger and the existing `LOG_LABEL`.

Failure diagnostics include:

- target format;
- failed operation, such as encode, publish, or cleanup;
- relevant path;
- filesystem error code when present;
- retained `.incomplete` path when cleanup was not possible.

Stale cleanup logs one concise summary when it removes files and one aggregated warning
when some eligible files could not be inspected or removed.

## 9. Test strategy

The focused regression suite must cover:

| Scenario | Assertion |
| --- | --- |
| Successful WebP and AVIF conversion | Final files decode successfully and no `.incomplete` artifacts remain |
| Caught Sharp failure | Final target is absent; staging is removed when cleanup succeeds |
| Failed immediate cleanup | Retained path has the exact plugin-owned `.incomplete` pattern and is logged |
| Fresh plugin-owned artifact | Startup cleanup preserves it |
| Stale artifact with a live owner PID | Startup cleanup preserves it |
| Stale artifact with a dead owner PID | Startup cleanup removes it |
| Foreign and malformed files | Startup cleanup leaves them byte-for-byte untouched |
| Forced process interruption | Final target is absent or decodable; a pre-publication interruption may leave a visible `.incomplete` artifact |
| Restart after interruption | Artificially aged orphan is removed and a subsequent conversion succeeds |
| Permission and filesystem errors | No unhandled rejection; sibling work and Vite shutdown continue |
| Excessively long target basename | Failure is explicit and no partial final target is created |
| Git cleanliness | A successful full suite restores the exact pre-test worktree state |

The forced-interruption test must synchronize on observation of the staging artifact
instead of sleeping for a fixed 400 ms. Timeouts are watchdogs only. File integrity is
verified by decoding or exact expected output, not by checking `size > 100`.

Injected `EACCES`, `EPERM`, `EROFS`, `ENOSPC`, `EDQUOT`, `EMFILE`, `ENFILE`, and
`EBUSY` cases use a package-private test adapter that is unavailable through the
package's public export. Real filesystem-shape tests cover portable cases such as
`ENOTDIR` and `ENAMETOOLONG`. `chmod` alone is not an acceptable cross-platform gate.

## 10. Acceptance criteria

- The staging name is self-describing, plugin-owned, unique, and ignored by image
  processing logic.
- Successful conversion leaves only the final target.
- A caught failure cannot leave a partial final target.
- `SIGKILL` is allowed to leave a visible `.incomplete` diagnostic artifact.
- Cleanup never removes fresh, live-owned, foreign, malformed, excluded, or symlinked
  entries.
- Write, rename, and cleanup failures do not crash the watcher or Vite server.
- No plugin-specific Git ignore rule or public configuration option is introduced.
- The fixed regression suite passes without fixed conversion sleeps or size-only
  integrity assertions.
- The full `npm run verify` gate and package dry run pass.
