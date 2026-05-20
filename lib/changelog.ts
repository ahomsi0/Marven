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
