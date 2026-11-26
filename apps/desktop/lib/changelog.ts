export type ChangeTag = "new" | "fix" | "imp";

export interface ChangeItem {
  tag: ChangeTag;
  label: string;
}

export interface Release {
  version: string;
  items: ChangeItem[];
}

export const CHANGELOG: Release[] = [
  {
    version: "2.19.0",
    items: [
      { tag: "new", label: "Mini Me builds websites and small apps: ask for one and he makes it in its own project folder, then ask for changes (\"make the background red\", \"add a contact section\") and he edits that same project" },
      { tag: "new", label: "No buttons to click: he just does it, and anything you ask while he works waits its turn, with several changes done in one go. Say \"no, make a new one\", \"just tell me\" or \"stop\" to change course" },
      { tag: "new", label: "A live preview docked beside Mini Me's bubble shows the site as he builds it, with buttons to open it in your browser, in Marven or in its folder; \"show me the preview of…\" opens any project you name" },
      { tag: "new", label: "Open in Marven picks up the project's one Agent conversation, with everything Mini Me did on it" },
      { tag: "new", label: "Mini Me looks up at a thought cloud while he thinks, and swipes a paint roller while he builds" },
      { tag: "new", label: "Mini Me on Linux: click, drag and type to him on Wayland too" },
      { tag: "new", label: "Mini Me can fall back to the Dock when you drop him somewhere else, and comes back onto the Dock when Marven starts" },
      { tag: "imp", label: "The sidebar footer is a profile card with your name and the model you're on, and a shorter menu behind its gear" },
      { tag: "imp", label: "Opening a built website is easy to find, and Open in browser works for pages on your computer" },
      { tag: "fix", label: "HTML previews no longer come up blank" },
      { tag: "fix", label: "The file tree fills in after you open a folder" },
      { tag: "fix", label: "In a narrow Agent panel, the Send button stays visible, the model menu stays on screen and the model name no longer covers the Lite badge" },
    ],
  },
  {
    version: "2.18.0",
    items: [
      { tag: "new", label: "Mini Me: a pixel-art mini you that lives above the Dock. Click it or press ⌘⇧Space and tell it what to do; it answers in a speech bubble (and out loud if you like), opens apps and sites, sets timers and reads your clipboard" },
      { tag: "new", label: "Mini Me walks, looks around, sits when you leave it alone and naps after a while; drag it anywhere, double-click to send it home, or say \"Hey Marven\" while it's on screen" },
      { tag: "new", label: "A Mini Me page in Settings: three hand-drawn art styles with hair styles, colours, glasses and a beard, a live animated preview, plus activity level, walk speed, size, nap timer, personality and shortcut" },
      { tag: "new", label: "Jobs that need your files, the terminal or the browser open in a new Agent chat with your request filled in, so the Agent's approvals still apply" },
      { tag: "imp", label: "Custom dropdowns throughout Settings" },
      { tag: "fix", label: "Spoken replies are no longer read out twice" },
      { tag: "fix", label: "Closing the main window on Windows and Linux quits Marven" },
    ],
  },
  {
    version: "2.17.0",
    items: [
      { tag: "new", label: "Two editor layouts, switched from the top bar: the editor with the agent chat beside it, or the editor on its own" },
      { tag: "new", label: "The terminal opens under the editor and Changes opens in the editor area, so neither closes your files; a status bar under the editor brings the terminal and problems back any time" },
      { tag: "imp", label: "The editor reads like one: normal line spacing without word wrapping, a faint current line, file icons on tabs and clearer breadcrumbs" },
      { tag: "imp", label: "Sharper buttons, cards and menus throughout, quieter message actions, and a clearer Chats / Agents switcher" },
      { tag: "imp", label: "Read only now explains what it means and lets you allow edits, and Files is renamed Editor" },
      { tag: "fix", label: "Previewing an HTML file loads its stylesheets, scripts and images" },
    ],
  },
  {
    version: "2.16.0",
    items: [
      { tag: "new", label: "Terminal settings: pick a colour theme, font, font size and cursor style in Settings → Terminal, or open it from the command palette" },
      { tag: "new", label: "Claude Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5, with Sonnet 5.5 as the default" },
      { tag: "imp", label: "Every cloud provider is updated to its current models; Groq now defaults to gpt-oss-120b, and NVIDIA and OpenRouter list their live models" },
      { tag: "imp", label: "Tidier sidebar, a single-card agent composer, and workspace panels driven from the top bar" },
      { tag: "imp", label: "The built-in terminal shows coloured output on macOS, and theme changes reach the open terminal and editor straight away" },
      { tag: "imp", label: "Only Marven itself can use its local API now; other programs on your computer are turned away, and API keys and app tokens are kept out of the terminal, agent commands and MCP servers" },
      { tag: "fix", label: "Models that providers shut down are gone from the pickers, which also fixes screenshots sent to Groq" },
    ],
  },
  {
    version: "2.15.0",
    items: [
      { tag: "new", label: "The agent can use the in-app browser — it opens pages in tabs of its own, reads them, clicks, types and scrolls while you watch in the side panel. Turn it on in Settings → General → \"Let the agent use the browser\"" },
      { tag: "new", label: "You stay in control: the agent asks before acting on each new site and before every form it submits, shows what would be sent, and you can Take over or Stop at any time" },
      { tag: "new", label: "The browser panel now opens in agent mode too, with a strip showing what the agent is doing" },
      { tag: "imp", label: "Safety built in: the agent never types passwords, card numbers or one-time codes, never downloads or uploads files, stays off your local network and Marven itself, and treats page text as data, not instructions" },
      { tag: "imp", label: "After you deny an action, the agent stops and asks what you'd like instead of looking for another way round" },
    ],
  },
  {
    version: "2.14.0",
    items: [
      { tag: "new", label: "In-app browser — open it from the globe in the chat header: tabs, bookmarks, history, downloads, find in page, a right-click menu, ad and tracker blocking, and a choice of search engine" },
      { tag: "new", label: "Ask Marven about the page you're reading — the browser hands it the page's text or your selection" },
      { tag: "new", label: "Arabic interface — switch the app language in Settings, with right-to-left layout throughout" },
      { tag: "new", label: "Command palette in chat and agent mode — jump to any Settings page, open a bookmark, or see keyboard shortcuts" },
      { tag: "new", label: "Edited and retried messages keep every version, and you can retry with a different model" },
      { tag: "new", label: "Memory page in Settings — edit or delete what Marven remembers, with Undo when something new is saved" },
      { tag: "new", label: "Report a problem from Settings, with app info and recent logs attached" },
      { tag: "new", label: "Agent mode works with LM Studio and llama-server; local vision models receive images" },
      { tag: "imp", label: "Redesigned agent workspace: the conversation comes first, with files, changes and the terminal in a slide-in panel" },
      { tag: "imp", label: "Reworked model picker, resizable sidebar and browser panel, a new logo, and a chat list with a ⋯ menu for Rename, Pin and Delete" },
      { tag: "imp", label: "The agent knows today's date, time and time zone" },
      { tag: "fix", label: "Ollama chats now have memory, the system prompt and streaming; replies can be stopped and one slow reply no longer blocks the others" },
      { tag: "fix", label: "Provider errors are shown as they are instead of \"couldn't reach the server\"" },
      { tag: "fix", label: "Saved API keys are no longer wiped when secure storage is unavailable" },
      { tag: "fix", label: "Quit works properly on macOS, only one copy of Marven runs, and deleted conversations stay deleted after a quick quit" },
      { tag: "fix", label: "The agent can't write outside the workspace through symlinks, and stopping a script stops its whole process tree" },
    ],
  },
  {
    version: "2.13.0",
    items: [
      { tag: "new", label: "Project rules file — drop a MARVEN.md (or .marven/rules.md) in your workspace and its conventions are injected into every agent run" },
      { tag: "new", label: "Conversations now persist to a local SQLite database, removing the localStorage size limit — image attachments and long histories survive restarts reliably" },
      { tag: "new", label: "Model failover — configure a fallback chain (e.g. Groq → OpenAI) and the agent automatically continues on rate limits or outages instead of failing mid-task" },
      { tag: "fix", label: "Switching agent conversations mid-run no longer streams the old reply into the wrong thread" },
      { tag: "fix", label: "A transient rate limit during auto-summarize no longer permanently truncates a conversation's memory" },
      { tag: "fix", label: "Agent approval gates and workspace containment are enforced from persisted settings server-side — crafted requests can no longer skip confirmations or read outside approved folders" },
      { tag: "fix", label: "Terminal sessions now survive collapsing the panel or switching workspaces — running dev servers keep going, and output is replayed when you return" },
      { tag: "fix", label: "Parallel tool calls from Claude/OpenAI-style models all execute; malformed tool-call arguments are reported back to the model instead of silently misfiring" },
      { tag: "fix", label: "Language-server and MCP child-process failures no longer take down the whole app" },
      { tag: "fix", label: "Checkpoint undo history is scoped per workspace and reverts keep working across agent conversations" },
      { tag: "imp", label: "File explorer preserves your collapsed folders during agent runs; chat auto-scroll no longer fights you while reading; wake-word keeps the last syllable of each command" },
      { tag: "imp", label: "Codebase indexing now reports failures (Ollama down, model mismatch) instead of quietly finishing with zero files indexed" },
    ],
  },
  {
    version: "2.12.4",
    items: [
      { tag: "fix", label: "Unsigned desktop builds no longer export empty certificate variables, allowing electron-builder to skip signing cleanly" },
    ],
  },
  {
    version: "2.12.3",
    items: [
      { tag: "fix", label: "Unsigned-release mode now lets macOS and Windows packaging proceed temporarily when signing certificates are unavailable" },
      { tag: "imp", label: "Automatic downloads and install-on-quit remain enabled; release logs clearly warn when artifacts are unsigned" },
    ],
  },
  {
    version: "2.12.2",
    items: [
      { tag: "fix", label: "Release verification now receives the same macOS and Windows signing configuration as the packaging step" },
    ],
  },
  {
    version: "2.12.1",
    items: [
      { tag: "fix", label: "Windows agent write approvals now normalize workspace paths correctly, restoring previews and rejection handling" },
      { tag: "fix", label: "CI uses Node 22 and Node 24-compatible GitHub Actions runtimes, removing the Node 20 deprecation warnings" },
    ],
  },
  {
    version: "2.12.0",
    items: [
      { tag: "fix", label: "External websites and local text-to-speech now launch through argument-safe processes, closing shell-injection paths" },
      { tag: "fix", label: "Conversation memory IDs, agent checkpoints, and checkpoint revert actions are restricted to their intended directories" },
      { tag: "fix", label: "Large existing files remain behind the write-approval gate, and read-only agents can no longer save memory" },
      { tag: "fix", label: "Production startup authenticates its local health check with a per-launch token before opening the app window" },
      { tag: "new", label: "Workspace safety profiles, encrypted settings, safer indexing, diagnostics, and release verification are now covered by focused regression checks" },
    ],
  },
  {
    version: "2.11.0",
    items: [
      { tag: "fix", label: "Security hardening pass — closed a command-injection path in open-in-browser, agent shell commands (run_command) now require your approval, added a content-security-policy and renderer sandbox, SSRF protections on the fetch_url tool, and workspace symlink-escape guards" },
      { tag: "fix", label: "Conversations are no longer silently lost when local storage fills up — image/document attachments are dropped first so your chat text is preserved, and deleting your last conversation now sticks across restarts" },
      { tag: "imp", label: "Provider API keys are kept out of the terminal and language-server processes; file writes no longer mangle content that legitimately contains backslash-n / backslash-t sequences" },
    ],
  },
  {
    version: "2.10.0",
    items: [
      { tag: "new", label: "Workflow Intelligence panel — one-click project scan (stack & entrypoints), change review with severity-ranked findings on your git diff, and a pre-release checklist; run any generated prompt straight through the agent" },
      { tag: "imp", label: "Groq agent now defaults to Llama 3.3 70B instead of 8B — far more reliable multi-step tool calling and instruction following (8B remains selectable for cheap/fast chat)" },
    ],
  },
  {
    version: "2.9.1",
    items: [
      { tag: "new", label: "Edit and resend past user messages in the agent panel (hover the bubble, then Save & resend)" },
      { tag: "fix", label: "Groq chat only sends image parts on Llama 4 Scout/Maverick; text-only Groq models get a clear note instead of API 400 errors" },
      { tag: "fix", label: "Agent with images on Groq vision models upgrades out of Lite tier, adds an image system cue, and keeps per-turn attachments in streamed history" },
    ],
  },
  {
    version: "2.9.0",
    items: [
      { tag: "new", label: "Agent session persistence — thread messages, open editor tabs, and file buffers restore when you return to a conversation" },
      { tag: "new", label: "Workspace disk watcher with a conflict modal when files change on disk while you have unsaved editor edits" },
      { tag: "new", label: "Problems tab in the agent workspace lists LSP diagnostics from open files" },
      { tag: "imp", label: "Editor remembers scroll position per tab; command palette and LSP rename wiring improvements" },
      { tag: "fix", label: "Safer open-in-browser and file:// handling for previews and external links (including Windows paths)" },
      { tag: "fix", label: "Removed the assistant \"Edit prompt\" control so AI replies are not paired with a misleading edit action" },
    ],
  },
  {
    version: "2.8.0",
    items: [
      { tag: "new", label: "Agent auto-verify runs lint, test, or build commands after file edits" },
      { tag: "new", label: "Scoped memory separates global, project, and conversation context" },
      { tag: "new", label: "Git assistant can generate commit messages, commit groups, PR summaries, and change explanations from the current diff" },
      { tag: "fix", label: "Workspace file routes now enforce root boundaries consistently across previews, raw files, serve, search, and replace" },
      { tag: "imp", label: "Git panel was redesigned into a cleaner status → inspect → commit workflow" },
    ],
  },
  {
    version: "2.7.0",
    items: [
      { tag: "new", label: "Adaptive Agent Lite Mode for small / weak models (≤13B) — auto-classifier, 4-tool simple tier, shorter system prompt, retry-on-stall, context pruning" },
      { tag: "new", label: "First-run onboarding wizard — detects Ollama / LM Studio / llama-server and recommends a starter model" },
      { tag: "new", label: "Embedding model auto-pull — nomic-embed-text downloads automatically on first indexing run, with a progress event" },
      { tag: "new", label: "Lite-mode indicator pill in the agent input status line" },
      { tag: "imp", label: "Six new weak-model guards: workspace-tree in lite prompt, phantom-directory refusal, read-before-write enforcement, single-write rule, size-shrink protection, stay-on-task rule" },
      { tag: "imp", label: "All pictographic emojis replaced with custom inline SVG icons" },
      { tag: "imp", label: "Shorter, single-line agent input placeholder" },
      { tag: "imp", label: "Cross-platform CI now runs tests on macOS, Windows, and Linux for every push" },
      { tag: "fix", label: "Codebase indexing TypeError ({}.resolve is not a function) — sqlite-vec and better-sqlite3 are now externalized from the Next bundle" },
      { tag: "fix", label: "better-sqlite3 upgraded to 12.x for compatibility with the Node 22+ V8 ABI used by current Electron" },
      { tag: "fix", label: "Clearer error when npm is not on PATH during LSP install" },
    ],
  },
  {
    version: "2.6.1",
    items: [
      { tag: "fix", label: "AI Backends toggles now reflect in model selector immediately" },
      { tag: "fix", label: "Model selector stays the same size across all tabs and states" },
    ],
  },
  {
    version: "2.6.0",
    items: [
      { tag: "new", label: "LM Studio local backend support" },
      { tag: "new", label: "llama-server (llama.cpp) local backend support" },
      { tag: "new", label: "Cloud/Local model selector with provider tabs" },
      { tag: "new", label: "AI Backends settings panel with provider toggles" },
      { tag: "imp", label: "Provider and model persist across sessions" },
    ],
  },
  {
    version: "2.5.3",
    items: [
      { tag: "new", label: "What's New card on first launch after update" },
      { tag: "new", label: "Midnight & Aurora themes" },
      { tag: "fix", label: "Voice no longer double-fires" },
      { tag: "fix", label: "STT audio fix for Groq" },
      { tag: "imp", label: "Windows keyboard shortcuts corrected" },
    ],
  },
];

export function getRelease(version: string): Release | undefined {
  return CHANGELOG.find((r) => r.version === version);
}
