# Marven

> An AI desktop assistant + full-featured code editor. Local-first when you choose Ollama; cloud providers optional.

Marven is a desktop app that combines a multi-provider AI chat with a complete coding agent — file-aware, with a CodeMirror 6 editor, a real interactive terminal, global search, and git tools. Bring your own API keys (Groq, OpenAI, Anthropic, OpenRouter, NIM) or run everything locally via Ollama. Your files, settings, and memory always stay on your machine; only your chosen AI provider sees prompts and (if you use voice) audio.

[![License: AGPLv3](https://img.shields.io/badge/license-AGPLv3-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/ahomsi0/Marven)](https://github.com/ahomsi0/Marven/releases/latest)

---

## Privacy — what stays on your machine

Always local (regardless of which provider you pick):

- **Your files** — only loaded when you open them, or when an agent reads/writes them as part of a task you initiated
- **Conversation history, settings, memory entries, recent workspaces** — stored in localStorage and a JSON settings file in your app data dir
- **API keys** — kept in the settings JSON, never sent anywhere except as the `Authorization` header to the provider you chose

What leaves your machine depends on which provider is selected:

| Provider | Where your prompts / code / audio go |
|---|---|
| **Ollama** | Nowhere — runs entirely on your machine |
| **Groq, OpenAI, Anthropic, OpenRouter, NVIDIA NIM** | To that provider's API (subject to their data-retention policy) |
| **"Hey Marven" voice (Local)** | Nowhere — runs entirely on your machine after first model download |
| **"Hey Marven" voice (Groq)** | Audio is sent to **Groq Whisper** for transcription |
| **`fetch_url` / `web_search` agent tools** | The URL or query you ask for is fetched / sent to DuckDuckGo |

If full privacy matters, use **Ollama** locally for chat/agent and the **Local** voice option (default).

---

## Features

### Editor (v2.0+)
- **CodeMirror 6** with syntax for 14 languages: JS/TS/JSX/TSX, Python, HTML, CSS/SCSS, JSON, Markdown/MDX, YAML, Rust, Java, C/C++, PHP, SQL, XML
- **Multi-cursor** editing, **code folding**, **bracket matching**, smart indent
- **Light + dark syntax themes** that follow the app theme
- Editor background matches the app chrome (no `oneDark` blue tint), and the active-line + bracket highlights are off so the code reads as one calm surface
- **⌘F find / ⌘⌥F replace** with match highlighting, ⌘G next, Esc to close
- **⌘⇧F global search** — grep across the workspace with click-to-open + line jump
- **⌘K inline AI edit** — select code, describe a change, AI rewrites the selection (Cursor-style)
- **⌘P quick file open** with fuzzy filename search
- **⌘⇧P command palette** for all editor actions
- **Multi-tab editor** with drag-reorder and per-tab buffer cache
- **Format-on-save** via Prettier (toggle in Settings → General)
- **Breadcrumbs** showing path segments
- **Markdown split preview** — open a `.md` file and the right pane renders rich GFM live as you type
- **Image previews** — `.png/.jpg/.svg/.webp/.gif` open inline with natural dimensions
- **PDF previews** — `.pdf` opens in the tab via the browser's built-in viewer

### Real interactive terminal (v2.0+)
- **xterm.js + node-pty** — type into it, run commands, see ANSI colors, use REPLs/TUIs (vim, top, etc.)
- One PTY per workspace, opens in your shell with your `$PATH`
- Launches as a **login shell** on Unix so `.zprofile` / `.bash_profile` get sourced and zsh stays in interactive mode
- Shell fallback chain (`$SHELL` → `/bin/zsh` → `/bin/bash` → `/bin/sh`) so a broken `$SHELL` env var doesn't brick the terminal
- node-pty `spawn-helper` permissions auto-fixed on `npm install` (npm sometimes drops the executable bit during tarball extraction)

### Agent mode
- **Three-pane layout**: file explorer · multi-tab editor · chat panel, all resizable
- **Built-in tools**: `read_file`, `write_file`, `list_files`, `search_files`, `run_command`, `web_search`, `fetch_url`, `remember`
- **Cross-platform `run_command`** — uses `sh -c` on Unix and `cmd.exe /d /s /c` on Windows so `npm start` / dev servers actually launch from the agent on Windows
- **Narrated tool-call recovery** — when smaller open-weights models (e.g. `llama-3.1-8b-instant`) write `<function(name){…}</function>` or `<tool_call>…</tool_call>` as text instead of using the OpenAI tool-call format, every provider client (Groq, OpenAI, Anthropic, OpenRouter, NIM, Ollama) recognises the narration and executes the call anyway
- **Git tools** with approval gating: `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`, `git_checkout`
- **Diff viewer** with per-file revert (checkpoint snapshots before agent writes)
- **MCP server support** (filesystem, GitHub, databases, anything that speaks Model Context Protocol)
- **Persistent memory** — `remember` tool stores facts across sessions
- **Per-conversation workspace** — each "New agent" remembers its own folder, open tabs, and message history (and new agents now start fresh — no stale workspace leaking through)
- **Independent chat & agent model selection** — picking a fast cheap model for chat doesn't downgrade the agent, and vice versa. Each mode tracks its own provider + per-provider model
- **Collapsible file tree** — click the chevron next to the project name to collapse / expand the whole tree
- **Live preview** — open HTML, Markdown, or image files in your chosen browser
- **Background tasks panel** with elapsed time + Stop button

### Chat mode
- **Six providers**: Groq, OpenAI, Anthropic, OpenRouter (free models), NVIDIA NIM, Ollama (local)
- **Conversation management**: pin, search by title, per-conversation system prompt, markdown export
- **Voice**: "Hey Marven" wake word + TTS (English + Arabic via macOS `Maged` voice). Defaults to a fully-local Whisper-tiny model (~150MB, downloaded once) so no API key is needed; switch to Groq Whisper in Settings → General if you'd prefer cloud speed.
- **Image attachments** for vision-capable models (paperclip, paste, drag-drop) — non-vision providers get a graceful note
- **Slash commands** + user-defined prompt templates
- **Natural-language actions**: "open Spotify", "open github", "what's the weather", "set a timer", "search Google for…", etc. App / website / search commands work on macOS, Windows, and Linux (Windows uses `start`, Linux uses `xdg-open`). Volume / media / screenshot / DND commands are macOS-only for now.

### Local voice (v2.1+)
- **Offline by default** — "Hey Marven" is transcribed on your machine using Whisper-tiny.en running in WASM via `transformers.js`. The ~145MB model downloads once on first use and is cached in IndexedDB.
- **Three checkpoint options** in Settings → General: Tiny.en (default, fastest download), Base.en (more accurate, ~290MB), or Distil-Small.en (best balance). Switch any time — the new model downloads on next use.
- WASM + fp32 backend is pinned so the model loads reliably across machines (the default WebGPU path occasionally ships a quantized variant whose scale tensors are missing).
- Switch to Groq Whisper for lower latency in **Settings → General → Voice recognition**.
- The input bar shows a **LOCAL** or **GROQ** chip so you can tell at a glance which backend is handling voice.
- Wake listener pauses automatically while Marven is speaking, so the mic doesn't pick up the TTS audio and re-trigger itself.

### System
- **Light + dark themes** with theme-tracked CSS variables
- **External browser routing** — AI-given links open in your preferred browser (Chrome / Firefox / Safari / Edge / Arc)
- **Auto-updater** via `electron-updater` (checks GitHub Releases on launch)

### Keyboard shortcuts
| Shortcut | Action |
|---|---|
| ⌘S | Save current file (formats first if Format-on-save is enabled) |
| ⌘W | Close active tab |
| ⌘B | Toggle file explorer |
| ⌃` | Toggle terminal |
| ⌃⌘I | Toggle chat panel |
| ⌘P | Quick file open (fuzzy) |
| ⌘⇧P | Command palette |
| ⌘⇧F | Global search |
| ⌘F | Find in current file |
| ⌘⌥F | Find and replace |
| ⌘G / ⌘⇧G | Next / previous match |
| ⌘K | Inline AI edit (with code selected) |
| ⌘⇧K | Search across all conversations |
| ⌘, | Open Settings |
| ⌥⌘I / F12 | Toggle DevTools (for debugging) |

---

## Install

### Download a release (recommended)

Grab the latest installer from the [**Releases page**](https://github.com/ahomsi0/Marven/releases/latest):

| Platform | File |
|---|---|
| **macOS** (Apple Silicon) | `Marven-<version>-arm64.dmg` |
| **Windows** | `Marven-Setup-<version>.exe` |
| **Linux** | `Marven-<version>.AppImage` |

**macOS:** open the DMG and drag Marven to `/Applications`. First launch may require right-click → Open to bypass Gatekeeper for unsigned apps.

**Windows:** run the EXE installer. Choose an install location when prompted.

**Linux:** mark the AppImage executable and run it:
```bash
chmod +x Marven-*.AppImage
./Marven-*.AppImage
```

The app auto-updates on launch.

### Build from source

Requires **Node.js 20+** and **npm**. The `node-pty` dependency uses a prebuilt native binding — most platforms work out of the box.

```bash
git clone https://github.com/ahomsi0/Marven.git
cd Marven
npm install

# Run in development (live reload)
npm run electron:dev

# Build a production installer for your current platform
npm run electron:build
```

Built artifacts land in `dist/`.

---

## First-time setup

Open Settings (⌘, or the sidebar gear) and go to **Integrations → API Keys**:

| Provider | Where to get a key | Free tier |
|---|---|---|
| **Groq** | [console.groq.com/keys](https://console.groq.com/keys) | Yes — fast Llama / Whisper |
| **OpenRouter** | [openrouter.ai/keys](https://openrouter.ai/keys) | Yes — free models like Gemma, DeepSeek |
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | Pay-as-you-go |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) | Pay-as-you-go |
| **NVIDIA NIM** | [build.nvidia.com](https://build.nvidia.com) | Limited free credits |
| **Ollama** | [ollama.com](https://ollama.com) — install locally | Free, fully offline |

You only need **one** to get started. Voice features ("Hey Marven", dictation) default to a local Whisper-tiny model that runs on your machine — no API key required. If you'd rather use Groq's cloud Whisper (lower latency), flip the provider in **Settings → General → Voice recognition** and make sure your Groq key is filled in. If Groq blocks `whisper-large-v3-turbo` for your org, Marven falls back to `whisper-large-v3` and `distil-whisper-large-v3-en` automatically.

### Picking a model

Pick by what you're doing. Agent (file-editing) needs tool calls and benefits from large context; chat is more forgiving and can run on smaller/cheaper models.

#### Free — no card required

| Model | Provider | Best for | Notes |
|---|---|---|---|
| **Llama 3.3 70B Versatile** | Groq | Agent ★ + Chat | Strong tool use, fast. Best free agent model. ~131K ctx |
| **Llama 3.1 8B Instant** | Groq | Chat, light agent | Very fast. Tool use OK on small tasks; can narrate calls on complex ones |
| **DeepSeek Chat v3** | OpenRouter (`deepseek/deepseek-chat-v3.1:free`) | Agent + Chat | Big context, solid reasoning. Free tier rate-limited |
| **Gemma 3 27B** | OpenRouter (`google/gemma-3-27b-it:free`) | Chat | Good general chat. Limited tool use — prefer for plain conversation |
| **Llama 4 Scout 17B** | Groq | Chat + vision | Free tier, supports image inputs |

Alternative: NVIDIA NIM has rotating free credits — `meta/llama-3.3-70b-instruct` is the safe pick there, though smaller NIM checkpoints sometimes describe tool calls instead of executing them.

#### Paid — pay-as-you-go

| Model | Provider | Best for | Rough cost |
|---|---|---|---|
| **Claude Sonnet 4.5** | Anthropic | Agent ★★★ (best overall) | $$ — premium quality, 200K ctx, excellent tool use |
| **Claude Haiku 4.5** | Anthropic | Agent + Chat | $ — fast, cheap, still better than most open-weights at tool use |
| **GPT-4o** | OpenAI | Agent + vision | $$ — strong vision, 128K ctx |
| **GPT-4o mini** | OpenAI | Chat, light agent | $ — cheap; weaker at multi-step tool use |
| **o3-mini** | OpenAI | Reasoning-heavy tasks | $$ — slower but thinks through complex problems |

If you have an existing ChatGPT subscription it does **not** include API access — you need a separate API credit balance at [platform.openai.com](https://platform.openai.com).

#### Local — fully offline via Ollama

Install [Ollama](https://ollama.com), `ollama pull <model>`, then pick "Ollama" as the provider in Marven.

| Model | Size | Best for | Heaviness |
|---|---|---|---|
| **qwen2.5-coder:14b** | ~9GB | Agent ★ (best local agent) | Needs 16GB+ RAM. Marven has a dedicated parser for its function-call syntax |
| **qwen2.5-coder:7b** | ~4.7GB | Agent (lighter) | Runs on 8GB+ RAM; tool use less reliable on complex tasks |
| **llama3.1:8b** | ~4.7GB | Chat + light agent | Solid all-rounder for chat. Tool use is hit-or-miss |
| **llama3.1:70b** | ~40GB | Agent ★★ (if you have the hardware) | Needs a workstation GPU or 64GB+ RAM. Closest local rival to Claude |
| **deepseek-r1:7b** | ~4.7GB | Reasoning chat | Thinks step-by-step. Slow but careful |
| **gemma3:12b** | ~7GB | Chat | Polished writing, weak tool use — pick for conversation, not agent |

**Rule of thumb:** anything ≤3B parameters tends to narrate tool calls instead of calling them. Marven has fallback parsers for the common formats (Llama `<function=name>` / Qwen `<tool_call>` / variant `<function(name){…}</function>`), but a stronger model is always more reliable. If your agent keeps describing what it would do instead of doing it, the model is too small or the system prompt isn't reaching it — try a bigger checkpoint first.

---

## Quick start

1. **Launch Marven.** Choose **Open project** on the landing page (or **Clone repo** to pull from Git).
2. **Pick agent mode** from the sidebar (+ New agent).
3. Try *"add a hello world button to index.html"* — the agent reads, writes, and surfaces the changes live in the editor.
4. Run *`npm start`* and the agent detects the live URL and gives you a clickable link routed through your chosen browser.
5. Or open the terminal panel (⌃`) and type commands yourself — it's a real shell.

Or skip the project — **+ New chat** for plain conversation, voice commands, image questions, etc.

---

## Tech stack

- **Next.js 15** (App Router) — runs in-process inside Electron
- **Electron 41** — desktop window + IPC + auto-updater
- **CodeMirror 6** — code editor with multi-language support
- **xterm.js + node-pty** — real interactive terminal
- **TypeScript** end-to-end
- **Tailwind CSS v4** with CSS-variable theme tokens
- **Vitest** — 67+ tests covering the agent loop, tool parsers, helpers

Project layout:

```
app/
  api/                  # Next.js API routes — chat, agent, workspace, mcp, memory, tts, stt, search
  components/marven/    # All UI components
hooks/                  # React hooks (useVoice, useAgentStream, useEditorShortcuts)
lib/
  agent/                # Agent loop, tool definitions, provider clients
  formatOnSave.ts       # Prettier wrapper
  theme.ts              # Theme hook + localStorage persistence
  workspaceState.ts     # Shared API-route module state
electron/               # Electron main + preload (incl. PTY manager)
docs/superpowers/       # Design specs & implementation plans
```

---

## Releases

Continuous releases publish via a `v*` tag push. CI builds Mac DMG, Windows EXE, and Linux AppImage in parallel and assembles them into one release. See [`.github/workflows/build.yml`](.github/workflows/build.yml).

---

## License

[AGPLv3](LICENSE) — see the LICENSE file for the full text.

**In short:** you can run, study, modify, and distribute Marven freely — but any modifications you distribute (or run as a network service) must also be released under AGPLv3 with source code available. This protects against proprietary forks or rebranded clones. No warranty.

Made by Ahmad Homsi.
