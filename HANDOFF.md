# Marven — Handoff

**Stack:** Next.js 15 App Router + Electron 41 + React 19 + Tailwind CSS
**App:** Local-first AI desktop assistant with chat, coding agent, editor, terminal, git, memory, voice, and codebase search.

## Current State

- Chat providers: Groq, OpenAI, Anthropic, OpenRouter, NVIDIA NIM, Ollama, LM Studio, llama-server.
- Agent mode streams tool calls through `app/api/agent/stream/route.ts` and `hooks/useAgentStream.ts`.
- Built-in agent tools include file read/write/patch, shell commands, git, DuckDuckGo web search, URL fetch, memory, and semantic codebase search.
- Voice input supports local Whisper via `transformers.js` and Groq Whisper.
- Speech output supports the local system voice and optional ElevenLabs TTS.
- Desktop packaging runs the standalone Next.js server in-process from `electron/main.js`.

## Key Files

| File | Purpose |
| --- | --- |
| `electron/main.js` | Electron entry, app window, tray, settings, env wiring, PTY, LSP bridge |
| `electron/preload.js` | Safe renderer IPC bridge |
| `app/page.tsx` | Top-level app orchestration and conversation/workspace state |
| `app/components/marven/` | UI components |
| `app/api/chat/route.ts` | Chat API route |
| `app/api/agent/stream/route.ts` | Streaming agent route |
| `hooks/useAgentStream.ts` | Agent SSE client |
| `hooks/useVoice.ts` | Wake word, manual voice capture, STT provider handling |
| `app/api/tts/route.ts` | System voice and ElevenLabs TTS route |
| `lib/agent/tools.ts` | Agent tool definitions and execution |
| `lib/index/` | Local semantic codebase index |

## Verification

Recommended pre-release checks:

```bash
npm audit --omit=dev
npm test
npm run build
npm run electron:build
```

`npx tsc --noEmit` depends on generated `.next/types`; run `npm run build` first or use a fresh build info file if checking manually.

## Known Follow-Ups

- Keep dependency advisories at zero before release.
- Consider splitting `app/page.tsx` and `SettingsModal.tsx`; both are large and hold many responsibilities.
- Consider Apple Developer code signing for smoother macOS distribution.
- If Google Custom Search is added later, keep DuckDuckGo as the default and make Google opt-in with explicit API key settings.
