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
- adding PID leases, heartbeat files, lock files, or error-specific retry policies;
- introducing a filesystem abstraction solely to inject rare operating-system errors;
- guaranteeing storage durability after sudden power loss;
- claiming atomic semantics for network filesystems that do not provide normal local
  filesystem rename guarantees.

## 3. Staging filename

For target `image.webp`, the staging path has this shape:

```text
image.webp.vite-webp-avif-generator.<random-id>.incomplete
```

Requirements:

- `.incomplete` is the final suffix, so Chokidar filtering, Vite, and asset tools do not
  treat the file as a supported image source;
- `vite-webp-avif-generator` identifies ownership for diagnostics and cleanup;
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
| Sharp, staging write, or final rename fails | Mark the format failed, remove its `.incomplete` file best-effort, and allow the sibling format and Vite server to continue |
| Immediate cleanup fails | Keep the self-describing `.incomplete` artifact; the original conversion error remains logged |
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

Safety rules:

- a future timestamp or clock ambiguity is treated as fresh;
- `ENOENT` during inspection or deletion is an expected cleanup race;
- foreign `.tmp`, `.incomplete`, malformed plugin-like files, directories, symlinks,
  and fresh plugin-owned files are never removed;
- overlapping watched folders are deduplicated before deletion;
- cleanup reuses the existing symlink-safe recursive listing and Vite logger instead of
  adding a second filesystem traversal abstraction.

The 24-hour TTL is an internal safety constant, not a new public option.

## 7. Git and developer experience

No `.gitignore` rule is added.

After an abnormal interruption, `git status` may intentionally show a path such as:

```text
image.webp.vite-webp-avif-generator.a1b2c3d4e5f60708.incomplete
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
- the original Sharp or filesystem error message;
- the source or target context already available at the failure boundary.

Stale cleanup logs one concise summary when it removes files. Existing directory-read
errors and per-file cleanup failures continue through the Vite logger.

## 9. Test strategy

The focused regression suite must cover:

| Scenario | Assertion |
| --- | --- |
| Successful WebP and AVIF conversion | Final files decode successfully and no `.incomplete` artifacts remain |
| Caught Sharp failure | Final target is absent; staging is removed when cleanup succeeds |
| Fresh plugin-owned artifact | Startup cleanup preserves it |
| Stale plugin-owned artifact | Startup cleanup removes it after 24 hours |
| Foreign and malformed files | Startup cleanup leaves them byte-for-byte untouched |
| Forced process interruption | Final target is absent or decodable; a pre-publication interruption may leave a visible `.incomplete` artifact |
| Restart after interruption | Artificially aged orphan is removed and a subsequent conversion succeeds |
| Representative conversion failure | No unhandled rejection; sibling work and Vite shutdown continue |
| Git cleanliness | A successful full suite restores the exact pre-test worktree state |

The forced-interruption test must synchronize on observation of the staging artifact
instead of sleeping for a fixed 400 ms. Timeouts are watchdogs only. File integrity is
verified by decoding or exact expected output, not by checking `size > 100`.

The existing invalid-Sharp-input case is the representative caught failure because all
encode and publication errors share the same format-level rejection path. The design
does not add an internal dependency-injection framework solely to synthesize individual
filesystem error codes. `chmod` is not used as a cross-platform release gate.

## 10. Acceptance criteria

- The staging name is self-describing, plugin-owned, unique, and ignored by image
  processing logic.
- Successful conversion leaves only the final target.
- A caught failure cannot leave a partial final target.
- `SIGKILL` is allowed to leave a visible `.incomplete` diagnostic artifact.
- Cleanup never removes fresh, foreign, malformed, excluded, or symlinked entries.
- Write, rename, and cleanup failures do not crash the watcher or Vite server.
- No plugin-specific Git ignore rule or public configuration option is introduced.
- The fixed regression suite passes without fixed conversion sleeps or size-only
  integrity assertions.
- The full `npm run verify` gate and package dry run pass.
