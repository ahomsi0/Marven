# What's New Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a dismissible floating card (bottom-right) on first launch after each version update, listing new features and bug fixes with colour-coded NEW / FIX / IMP tags.

**Architecture:** A new `lib/changelog.ts` holds release data. A new `WhatsNewCard` component reads the current version from `package.json`, compares it to `localStorage("marven_last_seen_version")`, and renders a fixed bottom-right card when the version is unseen. Dismissing writes the current version to localStorage so the card never shows again for that version.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Vitest, `package.json` version import.

---

### Task 1: Changelog data module + tests

**Files:**
- Create: `lib/changelog.ts`
- Create: `lib/changelog.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/changelog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CHANGELOG, getRelease } from "./changelog";

describe("CHANGELOG", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(CHANGELOG)).toBe(true);
    expect(CHANGELOG.length).toBeGreaterThan(0);
  });

  it("every entry has a semver-like version string", () => {
    for (const release of CHANGELOG) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("every item has a valid tag and non-empty label", () => {
    for (const release of CHANGELOG) {
      for (const item of release.items) {
        expect(["new", "fix", "imp"]).toContain(item.tag);
        expect(item.label.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("getRelease", () => {
  it("returns the release for a known version", () => {
    const r = getRelease(CHANGELOG[0].version);
    expect(r).toBeDefined();
    expect(r!.version).toBe(CHANGELOG[0].version);
  });

  it("returns undefined for an unknown version", () => {
    expect(getRelease("0.0.0")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run lib/changelog.test.ts
```

Expected: FAIL — `Cannot find module './changelog'`

- [ ] **Step 3: Implement `lib/changelog.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run lib/changelog.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/changelog.ts lib/changelog.test.ts
git commit -m "feat(changelog): add changelog data module"
```

---

### Task 2: WhatsNewCard component

**Files:**
- Create: `app/components/marven/WhatsNewCard.tsx`

No tests for this task — it is a pure UI component with no logic beyond what is already tested in Task 1. The version-detection + localStorage logic is simple enough to verify by running the app.

- [ ] **Step 1: Create `app/components/marven/WhatsNewCard.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import packageJson from "@/package.json";
import { getRelease } from "@/lib/changelog";

const STORAGE_KEY = "marven_last_seen_version";

// Colour config for each tag type
const TAG_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  new: { bg: "bg-[#98c379]/10", text: "text-[#98c379]", label: "NEW" },
  fix: { bg: "bg-[#e5c07b]/10", text: "text-[#e5c07b]", label: "FIX" },
  imp: { bg: "bg-[#61afef]/10", text: "text-[#61afef]", label: "IMP" },
};

export function WhatsNewCard() {
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const version = packageJson.version;
  const release = getRelease(version);

  useEffect(() => {
    if (!release) return;
    const seen = localStorage.getItem(STORAGE_KEY);
    if (seen !== version) {
      setVisible(true);
    }
  }, [version, release]);

  function dismiss() {
    setDismissing(true);
    localStorage.setItem(STORAGE_KEY, version);
    setTimeout(() => setVisible(false), 150);
  }

  if (!visible || !release) return null;

  return (
    <div
      className={`fixed bottom-5 right-5 z-50 w-64 rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] shadow-2xl transition-all duration-150 ${
        dismissing ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"
      }`}
      style={{ animation: dismissing ? undefined : "whatsNewIn 0.2s ease-out" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--m-border-subtle)] px-3 py-2">
        <span className="text-[11px] font-semibold tracking-wide text-[var(--m-text)]">
          ✦ What&apos;s new in v{version}
        </span>
        <button
          type="button"
          onClick={dismiss}
          className="text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)] text-base leading-none"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      {/* Items */}
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {release.items.map((item, i) => {
          const s = TAG_STYLE[item.tag];
          return (
            <div key={i} className="flex items-center gap-2">
              <span
                className={`shrink-0 rounded px-1.5 py-px text-[9px] font-semibold tracking-widest ${s.bg} ${s.text}`}
              >
                {s.label}
              </span>
              <span className="text-[11px] text-[var(--m-text-muted)]">{item.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the slide-in keyframe to `app/globals.css`**

Open `app/globals.css`. Find the last `@keyframes` block (or add after all existing rules). Append:

```css
@keyframes whatsNewIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/components/marven/WhatsNewCard.tsx app/globals.css
git commit -m "feat(ui): add WhatsNewCard floating component"
```

---

### Task 3: Wire WhatsNewCard into app/page.tsx

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add the import**

In `app/page.tsx`, find the block of component imports (around line 32 where `SetupModal` is imported). Add:

```ts
import { WhatsNewCard } from "@/app/components/marven/WhatsNewCard";
```

- [ ] **Step 2: Add the JSX**

In `app/page.tsx`, find the line:

```tsx
      {profileLoaded && userProfile === null && (
        <SetupModal onSave={handleProfileSave} />
      )}
```

Add `<WhatsNewCard />` directly after the closing `)}` of that block:

```tsx
      {profileLoaded && userProfile === null && (
        <SetupModal onSave={handleProfileSave} />
      )}
      <WhatsNewCard />
```

`WhatsNewCard` manages its own visibility entirely — no props or state needed in `page.tsx`.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all 117+ tests PASS (the new changelog tests added in Task 1 are now included).

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: mount WhatsNewCard in app — shows on first launch after update"
```
