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
