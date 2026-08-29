# Composite Export Auto-Authorization Design

## Goal

Allow composite batch export to write to any manually entered absolute output directory without losing access after the installed application restarts.

## Root Cause

Composite image writes use the shared Electron filesystem allowlist. A directory selected through the system picker is added only to an in-memory session allowlist. Manually entered preset paths are never added, and previously selected paths lose their session authorization after restart.

The renderer then receives `false` from `saveCompositeImage` and reports the generic `图片写入失败` message.

## Design

Add a composite-specific IPC operation that authorizes one absolute output root for the current export session.

Before collision detection or writing the first file under a resolved output root, the export runtime calls this operation. The main process:

1. validates that the payload is a non-empty absolute filesystem path;
2. normalizes the path;
3. adds it to the existing session allowlist; and
4. returns whether authorization succeeded.

The runtime caches authorized roots for the duration of one export run, so each distinct root is registered once. Because every export run performs this step, persisted preset paths work immediately after application restart.

After authorization, existing collision detection, recursive directory creation, data URL decoding, and image writing remain unchanged.

## Security Boundary

Only composite export receives automatic authorization. The shared filesystem handlers, ordinary generated-image saving, backups, imports, and unrelated IPC operations retain their current allowlist checks.

The dedicated operation accepts any absolute path because the user explicitly requires manually entered absolute paths to work. Relative paths, empty values, and malformed payloads remain rejected.

Operating-system restrictions still apply. Read-only locations, invalid Windows paths, unavailable drives, and directories denied by the current user account may still fail.

## Error Handling

If automatic authorization rejects a root, the export item fails with `输出目录必须是绝对路径`.

If authorization succeeds but the operating system later refuses directory creation or file writing, the existing export failure path remains responsible for reporting the write failure.

## Verification

Tests must prove:

- an arbitrary absolute directory can be authorized;
- relative, empty, and malformed values are rejected;
- the export runtime authorizes a resolved root before collision detection and image writing;
- one export run authorizes each distinct root only once;
- an authorization failure prevents write attempts and reports the absolute-path error; and
- existing collision suffix behavior still prevents overwriting files.

