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
    version: "2.5.2",
    items: [
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
