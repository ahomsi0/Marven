# What's New Card — Design Spec

## Goal

Show a dismissible floating card on first launch after each app update, listing the new features and bug fixes shipped in that version.

## Architecture

Three pieces:

1. **`lib/changelog.ts`** — the data source. Exports a typed array of release entries. Each entry has a version string and a list of changelog items. Prepending a new entry here is the only thing needed to update the changelog for future releases.

2. **`app/components/marven/WhatsNewCard.tsx`** — the UI component. Reads the current version from `package.json`, compares against `localStorage`, shows/hides itself, handles dismiss.

3. **`app/page.tsx`** — one import + one JSX line to mount the card. No props required.

## Data Model

```ts
// lib/changelog.ts
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
  // prepend future releases above this line
];
```

## Version Detection

On mount in `WhatsNewCard`:

```ts
const current = packageJson.version;                        // e.g. "2.5.2"
const seen    = localStorage.getItem("marven_last_seen_version");
const isNew   = seen !== current;
```

If `isNew` is true, show the card. On dismiss, write:

```ts
localStorage.setItem("marven_last_seen_version", current);
```

The card never shows again for this version.

## Component Behaviour

- **Position**: fixed, bottom-right, `bottom-5 right-5`, `z-50`
- **Entry animation**: fade + slide up (`opacity-0 translate-y-2` → `opacity-100 translate-y-0`), 200 ms ease-out
- **Exit animation**: fade out on dismiss, 150 ms, then `setVisible(false)` to unmount
- **Content**: title row "✦ What's new in vX.Y.Z" + × dismiss button, then the item list
- **Tag colours** (using existing Tailwind + CSS var patterns):
  - `new` → green (`#98c379`) background tint + label
  - `fix` → amber (`#e5c07b`) background tint + label
  - `imp` → blue (`#61afef`) background tint + label
- **Styling**: uses `var(--m-surface)`, `var(--m-border)`, `var(--m-text)`, `var(--m-text-faint)` tokens so it respects all four themes automatically

## Files

| File | Action |
|------|--------|
| `lib/changelog.ts` | Create |
| `app/components/marven/WhatsNewCard.tsx` | Create |
| `app/page.tsx` | Modify — add import + `<WhatsNewCard />` near end of JSX |

## Out of Scope

- Fetching changelog from a remote URL
- Showing changes from multiple past versions at once
- A "full changelog" link or modal
