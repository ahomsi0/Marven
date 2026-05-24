# Building Marven

This document covers building Marven for distribution. For day-to-day
development, just run `npm install && npm run electron:dev`.

## Native dependencies

Three native modules need to be rebuilt against Electron's Node ABI on the
target platform. They're rebuilt automatically by `scripts/rebuild-native.js`
(invoked from `npm postinstall`):

| Module          | What it does                              | Re-build sensitive? |
| --------------- | ----------------------------------------- | ------------------- |
| `better-sqlite3`| Sync SQLite for conversation storage + index | Yes — needs platform/arch-specific build |
| `sqlite-vec`    | Vector search SQLite extension            | Yes — ships per-platform binary packages |
| `node-pty`      | Terminal pty layer for the integrated terminal | Yes — needs platform/arch-specific build |

If something goes wrong on a fresh machine, the symptom is usually one of:

- `MODULE_NOT_FOUND` for `better-sqlite3` → run `npm run rebuild:native`
- `Error loading vec0 extension` → `sqlite-vec` package wasn't matched to the
  platform. Verify `node_modules/sqlite-vec-<platform>-<arch>/vec0.<ext>` exists.
- Permission errors on `node-pty` → see `scripts/fix-node-pty-perms.js`.

## Platform notes

### macOS

- Builds run on `macos-latest` runners (currently macOS 14, Apple Silicon).
- For `arm64`-targeted builds, the host needs to be arm64 — cross-compiling
  from x64 to arm64 has not been validated.
- Code signing happens in `scripts/after-sign.js`. Requires the standard
  `electron-builder` env vars: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`.

### Windows

- Builds run on `windows-latest` (Server 2022).
- No code signing wired up yet — installers ship unsigned. SmartScreen
  warnings will surface for users until a code-signing cert is added.

### Linux

- Builds produce an `.AppImage`.
- `node-pty` and `better-sqlite3` need build-essential + python3 on the
  build host. GitHub's `ubuntu-latest` image has them.

## Manual build

```bash
# Verify your environment first
npm test
npx tsc --noEmit

# Build the Next.js standalone server
npm run build
node scripts/prepare-standalone.js

# Build the Electron app for the current platform
npx electron-builder --mac   # or --win, --linux
```

Artifacts land in `dist/`.

## CI

| Workflow         | Triggers                  | Jobs |
| ---------------- | ------------------------- | ---- |
| `test.yml`       | push / PR to master, manual | `npm ci` + tsc + `npm test` on macOS, Windows, Linux |
| `build.yml`      | git tag `v*`, manual       | Build .dmg, .exe, .AppImage, attach to GitHub release |

## Stress testing before release

```bash
# Index a sizable repo to shake out native-dep / large-corpus bugs
npx tsx scripts/stress-index.mjs ~/code/some-large-repo

# Probe each completion provider you intend to ship-test
npx tsx scripts/smoke-completion.mjs ollama qwen2.5-coder:7b
npx tsx scripts/smoke-completion.mjs groq   llama-3.1-8b-instant
```

Both scripts exit non-zero on failure — wire them into a pre-release manual
checklist or a future `release-prep.yml` workflow.
