# Privacy Policy

**Last updated: 2026-11-10**

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
- **Local-first by default.** With Ollama, LM Studio, or llama-server as your
  provider, your prompts, code, and conversations stay on your computer.
  Marven still makes a few small requests of its own, such as looking up the
  weather when it starts; every one is listed under
  [Other network connections](#other-network-connections).
- **Open source.** You can audit every line of this claim.

---

## What data Marven processes

### 1. Your workspace files

- **Stored:** On your local filesystem, where they already were.
- **Sent over the network:** Only to the AI provider you've chosen for a
  given task. If that's `ollama`, `lmstudio`, or `llamaserver`, the request
  goes to `localhost` and never leaves your machine.
- **Stored by Marven:** Files you open are buffered in memory while editing.
  Dirty editor buffers and agent sessions are also persisted in browser
  `localStorage` so a restart can restore unsaved work. They remain on your
  machine unless included in a request to a provider you selected.

### 2. Conversation history

- **Stored:** Locally, in a SQLite database (`conversations.db`) in Marven's
  app data folder, with a working copy in the app's `localStorage`. This
  covers chat history, folders, edited and retried message versions, and
  agent transcripts.
- **Sent over the network:** Conversation history is included as context in
  AI provider requests when you continue a chat. Same rule as above: it only
  goes to the provider you've chosen.
- **Marven never reads, exports, or transmits this data anywhere else.**

### 3. Codebase index (vector embeddings)

- **Stored:** Locally in `~/.marven/index/<workspace-hash>/vectors.db`. SQLite
  with the `sqlite-vec` extension.
- **How embeddings are generated:** By calling the local Ollama server's
  `/api/embeddings` endpoint (defaults to `nomic-embed-text` model). If that
  model isn't installed, Ollama downloads it from its own model registry the
  first time you index.
- **Sent over the network:** None of your code. Embeddings are computed
  locally and stored locally.
- **Indexed content:** Marven honors the workspace `.gitignore`, excludes
  common secret files such as `.env*`, private keys, credentials, and
  certificates, and supports additional user-defined exclusions. Search
  results can still be included in a cloud-agent request when you choose a
  cloud provider.

### 4. Voice input and speech output

- **Voice input:** Local voice recognition runs on your machine. The Whisper
  model it uses is downloaded once from Hugging Face the first time you use
  voice (or switch to a different model size), then cached. If you switch
  voice recognition to Groq, recorded audio is sent to Groq Whisper for
  transcription.
- **Speech output:** The system voice runs locally. If you switch speech output
  to ElevenLabs, Marven sends the assistant reply text to ElevenLabs to generate
  audio.

### 5. The in-app browser

- **Stored:** Locally. Cookies and site data live in the browser's own
  persistent session, separate from the rest of the app. Open tabs, history,
  bookmarks, and per-site ad-blocking choices are saved as JSON files in the
  `browser` folder of Marven's app data folder. Downloads go to your Downloads
  folder.
- **Sent over the network:** Like any browser, the pages you open are loaded
  from the sites that serve them, and searches go to the search engine you
  picked in Settings. Sites see a plain Chrome user agent, not "Marven".
- **Ad and tracker blocking:** The EasyList and EasyPrivacy filter lists are
  downloaded from the Ghostery adblocker project on GitHub the first time you
  open the browser, and refreshed when the saved copy is more than a week old.
- **"Ask about this page":** Sends that page's text, or your selection, to
  the AI provider you've chosen, as part of your message.

### 6. Agent browsing

Off by default. You turn it on in **Settings → General → "Let the agent use
the browser"**.

- **What the agent's provider receives:** The text of the pages the agent
  reads, and screenshots of them when the model can see images. Page content
  goes to your chosen AI provider in the same way as file content does.
- **Your sign-ins:** The agent's tabs use the same browser session as your own
  tabs, so on a site where you're signed in, the agent acts as you. It asks
  before acting on each new site and before every form it submits, showing
  what would be sent.
- **Where it can't go:** The agent can't open addresses on your private
  network or Marven's own address, and it never downloads or uploads files.

---

## What gets sent to AI providers

When you make a request using a cloud AI provider (Groq, OpenAI, Anthropic,
NVIDIA NIM, OpenRouter), Marven sends:

- Your prompt
- Recent conversation history (for context)
- Any `@file` / `@folder` content you've explicitly attached
- The workspace file tree (only when "Lite agent mode" is enabled, to
  prevent hallucinated paths)
- Selected file content when you ask the agent to read or modify a file
- Page text, or a selection, when you ask Marven about a page in the in-app
  browser
- Page text and screenshots from the pages the agent visits, when agent
  browsing is on

Marven uses the API keys **you** provide in Settings. Marven has no shared
API key, no proxy, and no relay server. Requests go directly from your
machine to the provider you chose, exactly as if you'd called their API
yourself.

Each AI provider has its own privacy policy. Read theirs to understand what
they do with the data you send to them. Notably:

- **Anthropic** and **OpenAI** do not use API requests for training by
  default (as of 2025), but verify their current terms.
- **Groq** and other "fast" providers may retain logs for abuse prevention.
- **ElevenLabs** receives assistant reply text only when ElevenLabs speech
  output is selected.
- **Local providers (Ollama, LM Studio, llama-server)** keep everything on
  your machine.

---

## Other network connections

Besides your AI provider and the in-app browser, these are all the requests
Marven makes, and when it makes them.

**On its own:**

- **Weather, every time Marven starts.** Marven asks `ipapi.co` for your
  approximate location, which shares your IP address with that service.
  It then asks `api.open-meteo.com` for the current weather at those
  approximate coordinates. The result appears in the app and in `/briefing`.
- **Updates.** The built-in updater checks this repository's GitHub releases
  and downloads new versions from there.
- **Ad and tracker filter lists**, as described under
  [The in-app browser](#5-the-in-app-browser).

**When you use a feature that needs it:**

- **`/briefing`** fetches the top BBC News headlines through
  `api.rss2json.com`.
- **Local voice** downloads the Whisper model from Hugging Face once.
- **Codebase indexing** may make Ollama download its embedding model once.
- **Code intelligence** (go to definition, hover, errors): the first time you
  open a file in a language whose language server isn't installed yet, Marven
  runs `npm install` to fetch it from the npm registry into `~/.marven/lsp/`.
- **Clone repo** contacts the Git host you give it.
- **Agent tools:** `web_search` sends your query to DuckDuckGo's Instant Answer
  API; `fetch_url` fetches the address it's given. `run_command`, the git
  tools, and any MCP servers you add can reach whatever the command or server
  connects to.
- **Report a problem** sends nothing from the app. It opens a GitHub issue
  form in your web browser with the report (your description, app info, and
  recent logs with secrets removed) filled in. That text travels in the link
  itself, so GitHub receives it when the page opens. Nothing is posted until
  you submit the form.

---

## What Marven never does

- We do not collect crash reports automatically.
- We do not phone home to check for updates from Marven's servers. The
  built-in updater queries the GitHub releases API directly (which is a
  public, anonymous endpoint).
- We do not run analytics or A/B tests.
- We do not have a "Marven account". There is nothing to log in to.
- We do not share data with third parties because we don't have any data to
  share.

---

## API keys

API keys you enter in Settings (for cloud AI providers and ElevenLabs) are stored
locally on your machine in Marven's Electron settings file. Electron encrypts
them with the operating system secure-storage facility when available and
restricts the fallback file to the current user. The renderer receives only a
masked placeholder. Keys are never sent to any Marven-controlled service,
because no such service exists.

---

## Open source verification

Every claim above can be verified by reading the source code. The desktop
app lives in `apps/desktop/`, and the paths below are relative to it:

- The list of network endpoints Marven contacts: `lib/groq.ts`,
  `lib/openai.ts`, `lib/anthropic.ts`, `lib/nim.ts`, `lib/openrouter.ts`,
  `lib/ollama.ts`, `lib/lmstudio.ts`, `lib/llamaserver.ts`, and
  `app/api/tts/route.ts` for optional ElevenLabs speech output. Those are
  the files that make outbound HTTP calls related to AI and voice.
- The other requests: `app/api/weather/route.ts`, `app/api/news/route.ts`,
  `lib/localStt.ts` (Whisper download), `lib/agent/tools.ts` (`web_search`,
  `fetch_url`), `electron/lsp/lspManager.js` (language servers),
  `lib/glitchReport.ts` (Report a problem), and `electron/browser/` (the
  in-app browser, its ad blocker, and agent browsing).
- No analytics or telemetry SDK is listed in `package.json`. Search it for
  yourself: `grep -E "posthog|sentry|mixpanel|datadog|amplitude" apps/desktop/package.json`.
- The auto-updater code: `electron/main.js`, which uses `electron-updater`
  pointing at this repository's GitHub releases.

If you find any outbound network call not documented here, please open an
issue. We treat that as a bug.

---

## Contact

Questions or concerns: open an issue at
https://github.com/ahomsi0/Marven/issues
