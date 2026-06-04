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
