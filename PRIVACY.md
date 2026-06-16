# Privacy Policy

**Last updated: 2026-06-15**

Marven is built on a simple promise: **your code is yours.** This document
explains exactly what data Marven handles, where it goes, and what it never
touches.

---

## TL;DR

- **Marven contains zero telemetry.** No analytics SDK, no crash reporter, no
  usage tracking. We do not know whether you have Marven installed, what files
  you open, or what prompts you send.
- **Your code never leaves your machine unless you ask it to** by selecting a
  cloud AI provider for a request.
- **Local-first by default.** Marven works fully offline with Ollama,
  LM Studio, or llama-server. In that mode, *nothing* leaves your computer.
- **Open source.** You can audit every line of this claim.

---

## What data Marven processes

Marven operates on three kinds of data:

### 1. Your workspace files

- **Stored:** On your local filesystem, where they already were.
- **Sent over the network:** Only to the AI provider you've chosen for a
  given task. If that's `ollama`, `lmstudio`, or `llamaserver`, the request
  goes to `localhost` — never leaves your machine.
- **Stored by Marven:** Files you open are buffered in memory while editing.
  No file content is written to disk except where you explicitly save it.

### 2. Conversation history

- **Stored:** Locally in your Marven app data directory
  (`~/Library/Application Support/Marven/` on macOS, equivalent on other OS).
  This is a SQLite database on your machine.
- **Sent over the network:** Conversation history is included as context in
  AI provider requests when you continue a chat. Same rule as above — only
  goes to the provider you've chosen.
- **Marven never reads, exports, or transmits this data anywhere else.**

### 3. Codebase index (vector embeddings)

- **Stored:** Locally in `~/.marven/index/<workspace-hash>/vectors.db`. SQLite
  with the `sqlite-vec` extension.
- **How embeddings are generated:** By calling the local Ollama server's
  `/api/embeddings` endpoint (defaults to `nomic-embed-text` model).
- **Sent over the network:** Nothing. Embeddings are computed locally and
  stored locally.

### 4. Voice input and speech output

- **Voice input:** Local voice recognition runs on your machine. If you switch
  voice recognition to Groq, recorded audio is sent to Groq Whisper for
  transcription.
- **Speech output:** The system voice runs locally. If you switch speech output
  to ElevenLabs, Marven sends the assistant reply text to ElevenLabs to generate
  audio.

---

## What gets sent to AI providers

When you make a request using a cloud AI provider (Groq, OpenAI, Anthropic,
NVIDIA NIM, OpenRouter), Marven sends:

- Your prompt
- Recent conversation history (for context)
- Any `@file` / `@folder` content you've explicitly attached
- The workspace file tree (only when "Lite agent mode" is enabled — used to
  prevent hallucinated paths)
- Selected file content when you ask the agent to read or modify a file

Marven uses the API keys **you** provide in Settings. Marven has no shared
API key, no proxy, and no relay server. Requests go directly from your
machine to the provider you chose, exactly as if you'd called their API
yourself.

Each AI provider has its own privacy policy — read theirs to understand what
they do with the data you send to them. Notably:

- **Anthropic** and **OpenAI** do not use API requests for training by
  default (as of 2025), but verify their current terms.
- **Groq** and other "fast" providers may retain logs for abuse prevention.
- **ElevenLabs** receives assistant reply text only when ElevenLabs speech
  output is selected.
- **Local providers (Ollama, LM Studio, llama-server)** keep everything on
  your machine.

---

## What Marven never does

- We do not collect crash reports automatically.
- We do not phone home to check for updates from Marven's servers. The
  built-in updater queries the GitHub releases API directly (which is a
  public, anonymous endpoint).
- We do not run analytics or A/B tests.
- We do not have a "Marven account" — there is nothing to log in to.
- We do not share data with third parties because we don't have any data to
  share.

---

## API keys

API keys you enter in Settings (for cloud AI providers and ElevenLabs) are stored
locally on your machine in Marven's Electron settings file. They are never sent
to any Marven-controlled service, because no such service exists.

---

## Open source verification

Every claim above can be verified by reading the source code:

- The list of network endpoints Marven contacts: `lib/groq.ts`,
  `lib/openai.ts`, `lib/anthropic.ts`, `lib/nim.ts`, `lib/openrouter.ts`,
  `lib/ollama.ts`, `lib/lmstudio.ts`, `lib/llamaserver.ts`, and
  `app/api/tts/route.ts` for optional ElevenLabs speech output — those are
  the files that make outbound HTTP calls related to AI and voice.
- No analytics or telemetry SDK is listed in `package.json`. Search it for
  yourself: `grep -E "posthog|sentry|mixpanel|datadog|amplitude" package.json`.
- The auto-updater code: `electron/main.js` — uses `electron-updater`
  pointing at this repository's GitHub releases.

If you find any outbound network call not documented here, please open an
issue. We treat that as a bug.

---

## Contact

Questions or concerns: open an issue at
https://github.com/ahomsi0/Marven/issues
