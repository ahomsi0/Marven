# Marven — Handoff

**Repo:** https://github.com/ahomsi0/Marven  
**Stack:** Next.js 15 (App Router) + Electron 41 + Tailwind CSS  
**Latest tag:** v1.0.3 (on GitHub) — local `electron/main.js` has unpushed fix (see below)

---

## What Marven Is

A local AI desktop assistant with two modes:
- **Chat mode** — conversational AI via Groq (cloud) or Ollama (local)
- **Agent mode** — tool-use loop that can read/write files, run commands, search code, start dev servers

---

## Current State

### What works
- Full chat UI with Groq and Ollama providers
- Agent panel with tools: `read_file`, `write_file`, `list_files`, `search_files`, `run_command`
- Slash commands in agent panel (`/clear`, `/refresh`, `/help`)
- Stop button during agent runs
- Clickable URLs in tool output
- Server commands run in background, return live URL automatically
- Unified `#d19a66` sand orange accent across the entire UI
- GitHub repo live at https://github.com/ahomsi0/Marven
- GitHub Actions CI building Mac DMG + Windows EXE + Linux AppImage on tag push
- Auto-updater wired up via `electron-updater` (checks GitHub Releases on launch)

### Known issues / active debugging

**Packaged app shows black screen (Mac)**  
Root cause: `identity: null` in `package.json` disables code signing. On arm64 macOS, unsigned apps can't spawn unsigned child processes — the Next.js server never starts.

**Fix in progress (NOT yet committed/pushed):**  
`electron/main.js` — `startNextServer()` now runs the Next.js standalone server **in-process** via `require(serverScript)` instead of spawning a child process. This avoids the signing issue entirely.

```js
// New approach — no child process, no signing needed
setImmediate(() => {
  try { require(serverScript); } catch (err) { ... }
});
return waitForPort(3000);
```

**This fix is sitting uncommitted locally.** Test it first:
```bash
xattr -cr /Applications/Marven.app
cp -r "dist/mac-arm64/Marven.app" /Applications/
/Applications/Marven.app/Contents/MacOS/Marven
```
If the app loads, commit and push as v1.0.4:
```bash
git add electron/main.js
git commit -m "fix: run Next.js server in-process to avoid unsigned arm64 spawn"
git push
git tag v1.0.4 && git push origin v1.0.4
```

---

## Key Files

| File | Purpose |
|------|---------|
| `electron/main.js` | Electron entry — starts Next.js server, creates window, tray, shortcuts |
| `electron/preload.js` | Context bridge (IPC between renderer and main) |
| `app/page.tsx` | Main UI — chat + agent layout |
| `app/components/marven/` | All UI components |
| `hooks/useAgentStream.ts` | SSE streaming hook for agent tool calls |
| `lib/agent/tools.ts` | Tool definitions + executor (read/write/run/search) |
| `lib/agent/ollama.ts` | Ollama provider + JSON tool call fallback parser |
| `lib/agent/groq.ts` | Groq provider |
| `app/api/agent/stream/route.ts` | SSE streaming endpoint for agent |
| `scripts/prepare-standalone.js` | Copies `.next/static` + `public` into standalone output pre-build |
| `.github/workflows/build.yml` | CI: builds all 3 platforms on `v*` tag push |

---

## Build & Release

**Dev:**
```bash
npm run electron:dev
```

**Local production build (Mac arm64):**
```bash
npm run electron:build
# Output: dist/Marven-1.0.0-arm64.dmg
```

**Release (triggers GitHub Actions → Mac + Win + Linux):**
```bash
# Bump version in package.json first, then:
git tag v1.x.x && git push origin v1.x.x
```
GitHub Actions builds all platforms and publishes to GitHub Releases automatically.

**Users get auto-updates** — `electron-updater` checks GitHub Releases on every app launch.

---

## Ollama Notes

- Models ≤3B params are blocked early (`SMALL_MODEL_RE` in `lib/agent/ollama.ts`)
- `qwen2.5-coder` outputs tool calls as inline JSON text — handled by `extractJsonToolCall()` fallback
- Capable models list: `llama3.1`, `llama3.2`, `qwen2.5-coder`, `mistral-nemo`, `mistral`, `hermes3`

---

## Pending / Next Steps

- [ ] Verify in-process server fix works (test locally, then push v1.0.4)
- [ ] Verify Windows fix works (download v1.0.4 EXE once CI completes)
- [ ] Add `author` field to `package.json` (electron-builder warns about it)
- [ ] Create a `public/` directory if static assets are ever needed
- [ ] Consider proper Apple Developer code signing for distribution
