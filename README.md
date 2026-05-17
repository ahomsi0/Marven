# Marven

> A local AI desktop assistant — your data, your machine.

Marven is a desktop app that combines a multi-provider AI chat with a VS Code–style coding agent. Bring your own API keys (Groq, OpenAI, Anthropic, OpenRouter, NIM) or run everything locally via Ollama. Files, conversations, and memory stay on your machine.

[![License: AGPLv3](https://img.shields.io/badge/license-AGPLv3-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/ahomsi0/Marven)](https://github.com/ahomsi0/Marven/releases/latest)

---

## Features

### Chat mode
- **Six providers**: Groq, OpenAI, Anthropic, OpenRouter (free models), NVIDIA NIM, Ollama (local)
- **Conversation management**: pin, search, per-conversation system prompt, markdown export
- **Voice**: "Hey Marven" wake word + TTS (English + Arabic via macOS `Maged` voice)
- **Image attachments** for vision-capable models (paperclip, paste, drag-drop)
- **Slash commands** + user-defined prompt templates
- **Natural-language actions**: "what's the weather", "take a screenshot", "set a timer", "open Spotify", etc.

### Agent mode
- **VS Code–style layout**: file explorer · multi-tab editor · chat panel, all resizable
- **Multi-tab editor** with drag-reorder and per-tab buffer cache
- **Built-in tools**: `read_file`, `write_file`, `list_files`, `search_files`, `run_command`, `web_search`, `fetch_url`, `remember`
- **Git tools** with approval gating: `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`, `git_checkout`
- **Diff viewer** with per-file revert (checkpoint snapshots before agent writes)
- **Live terminal** streaming `run_command` output line-by-line
- **MCP server support** (filesystem, GitHub, databases, anything that speaks Model Context Protocol)
- **Persistent memory** — `remember` tool stores facts across sessions
- **Live preview** — open the active HTML file in your chosen browser

### System
- **Keyboard shortcuts**: ⌘S save · ⌘W close tab · ⌘B sidebar · ⌃` terminal · ⌃⌘I chat panel · ⌘P quick file open · ⌘⇧P command palette
- **Quick file open** (⌘P) and **command palette** (⌘⇧P) for fuzzy navigation
- **External browser routing** — AI-given links open in your preferred browser (Chrome / Firefox / Safari / Edge / Arc)
- **Auto-updater** via `electron-updater` (checks GitHub Releases on launch)

---

## Install

### Download a release (recommended)

Grab the latest installer for your platform from the [**Releases page**](https://github.com/ahomsi0/Marven/releases/latest):

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

The app will check for updates automatically on every launch.

### Build from source

Requires **Node.js 20+** and **npm**.

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

Open Settings (⌘, or the sidebar gear) and head to **Integrations → API Keys**:

| Provider | Where to get a key | Free tier |
|---|---|---|
| **Groq** | [console.groq.com/keys](https://console.groq.com/keys) | Yes — fast Llama / Whisper |
| **OpenRouter** | [openrouter.ai/keys](https://openrouter.ai/keys) | Yes — free models like Gemma, DeepSeek |
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | Pay-as-you-go |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) | Pay-as-you-go |
| **NVIDIA NIM** | [build.nvidia.com](https://build.nvidia.com) | Limited free credits |
| **Ollama** | [ollama.com](https://ollama.com) — install locally | Free, fully offline |

You only need **one** to get started. Voice ("Hey Marven") uses the Groq Whisper API, so a Groq key is required for that feature.

### Picking a model

- **Best agentic behavior**: Claude Sonnet 4.5, GPT-4o, Llama 3.3 70B (on Groq)
- **Cheap + fast**: Llama 3.1 8B on Groq, Gemma 3 27B on OpenRouter
- **Fully local**: Ollama with `qwen2.5-coder` or `llama3.1` (8B+ params for reliable tool use)

Smaller models (≤3B) tend to narrate tool calls instead of executing them. Marven includes fallback parsers for known quirks (e.g., qwen2.5-coder's function-call syntax) but a stronger model will always be more reliable.

---

## Quick start

1. **Launch Marven.** Choose **Open project** on the landing page (or **Clone repo** to pull from a Git URL).
2. **Pick agent mode** from the sidebar (+ New agent) once your folder is open.
3. Type something like *"add a hello world button to index.html"* — the agent reads, writes, and surfaces the changes inline.
4. Run *`npm start`* and the agent will detect the live URL and hand it back to you as a clickable link routed through your preferred browser.

Or skip the project entirely — **+ New chat** for plain conversation, voice commands, image questions, etc.

---

## Tech stack

- **Next.js 15** (App Router) — runs in-process inside Electron
- **Electron 41** — desktop window + IPC + auto-updater
- **TypeScript** end-to-end
- **Tailwind CSS v4** for styling
- **Vitest** for tests (60+ unit tests cover the agent loop, tool parsers, helpers)

Project layout:

```
app/
  api/             # Next.js API routes — chat, agent, workspace, mcp, memory, tts, stt
  components/marven/  # All UI components
hooks/             # React hooks (useVoice, useAgentStream, useEditorShortcuts)
lib/
  agent/           # Agent loop, tool definitions, provider clients (groq/openai/anthropic/ollama/...)
  *.ts             # Shared helpers (speak, storage, memory, mcp client, etc.)
electron/          # Electron main + preload
docs/superpowers/  # Design specs & implementation plans (waves 1–5)
```

---

## Releases

Continuous releases are published to GitHub via a `v*` tag push. The CI builds Mac DMG, Windows EXE, and Linux AppImage in parallel and uploads them to a single release. See [`.github/workflows/build.yml`](.github/workflows/build.yml).

---

## License

[AGPLv3](LICENSE) — see the LICENSE file for the full text.

**In short:** you can run, study, modify, and distribute Marven freely — but any modifications you distribute (or run as a network service) must also be released under AGPLv3 with the source code available. This protects against proprietary forks or rebranded clones. No warranty.

Made by Ahmad Homsi.
