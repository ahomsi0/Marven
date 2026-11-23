# Mini Me Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pixel-art "mini you" that lives in a small transparent always-on-top window, walks along the bottom of the screen, and runs what you tell it through Marven's existing chat, command, voice and speech pipeline.

**Architecture:** Electron main process gets a `companion.js` module that owns a second `BrowserWindow` (transparent, click-through except over the character) and moves it around (walking, dragging, staying on screen). The window loads a new Next.js route `/companion`, whose React page runs a pure behaviour state machine, draws the character procedurally from a `look.json` palette, and sends input through a `useCompanionBrain` hook that reuses `/api/chat` (which already executes system commands), `lib/speak.ts` and `hooks/useVoice.ts`.

**Tech Stack:** Electron 41, Next.js 15 App Router, React 19, TypeScript, Tailwind, Vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-11-23-mini-me-companion-design.md`

**Conventions (all paths relative to `apps/desktop/` unless they start with `docs/`):**
- Run every command from `apps/desktop`.
- Tests: `npx vitest run <file>`; full suite `npm test`; types `npm run typecheck`.
- Electron modules are CommonJS; their tests load them with `createRequire` (see `electron/apiToken.test.ts`).
- Commit after each task. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/chatIntents.ts` | new | `parseTimer`, `detectClipboardAction`, `clipboardPrompt` (moved out of `app/page.tsx`) |
| `lib/chatPrompt.ts` | new | `ScopedMemories`, `buildMemoryContext`, `buildSystemPrompt` (moved out of `app/page.tsx`) |
| `app/page.tsx` | modify | import the moved helpers; Mini Me wake-word hand-over, "Open in Marven", "Open settings" listeners |
| `electron/companionPlacement.js` | new | pure geometry: window size, dock strip, clamping, restore, stepping |
| `electron/companion.js` | new | companion window lifecycle, walking/drag/drop, hotkey, IPC |
| `electron/apiToken.js` | unchanged | (the caller's `isAppWebContents` gains the companion window) |
| `electron/main.js` | modify | settings defaults, wiring, tray item, ⌘⇧M routing, token for companion |
| `electron/preload.js` | modify | `marvenElectron.companion.*` bridge + main-window listeners |
| `lib/companion/behaviour.ts` | new | pure animation/movement state machine |
| `lib/companion/brain.ts` | new | routing, persona prompt, rolling history |
| `lib/companion/look.ts` | new | `Look` type, defaults, validation |
| `lib/companion/sprite.ts` | new | frame specs, animations table, procedural 32×32 renderer |
| `lib/companion/bridge.ts` | new | typed access to `window.marvenElectron.companion` |
| `public/companion/look.json` | new | the user's colours and features |
| `hooks/useCompanionBrain.ts` | new | runs a request: timer / clipboard / agent hand-off / chat+command, streaming, TTS |
| `app/companion/page.tsx` | new | the companion window page |
| `app/companion/CompanionSprite.tsx` | new | canvas animation player |
| `app/companion/SpeechBubble.tsx` | new | reply text, input, action buttons |
| `app/components/marven/MiniMeSettings.tsx` | new | Settings → General "Mini Me" card |
| `app/components/marven/SettingsModal.tsx` | modify | render `<MiniMeSettings />` |
| `lib/i18n/settings.en.ts`, `lib/i18n/settings.ar.ts` | modify | Mini Me strings |

---

### Task 1: Move chat intents and the system prompt builder out of `app/page.tsx`

Mini Me needs the same timer/clipboard detection and the same base system prompt as the main chat. They are private functions in `app/page.tsx`; move them to `lib/` unchanged.

**Files:**
- Create: `lib/chatIntents.ts`, `lib/chatIntents.test.ts`, `lib/chatPrompt.ts`, `lib/chatPrompt.test.ts`
- Modify: `app/page.tsx` (lines ~122–158, ~175–180, ~206–230, ~1794–1810)

- [ ] **Step 1: Write the failing tests**

`lib/chatIntents.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseTimer, detectClipboardAction, clipboardPrompt } from "./chatIntents";

describe("parseTimer", () => {
  it("parses minutes", () => {
    expect(parseTimer("set a timer for 5 minutes")).toEqual({ ms: 300_000, label: "5 minutes" });
  });
  it("parses a single second", () => {
    expect(parseTimer("timer 1 second")).toEqual({ ms: 1000, label: "1 second" });
  });
  it("parses hours", () => {
    expect(parseTimer("set timer 2 hours")).toEqual({ ms: 7_200_000, label: "2 hours" });
  });
  it("ignores other text", () => {
    expect(parseTimer("what time is it")).toBeNull();
  });
});

describe("detectClipboardAction", () => {
  it("detects each action", () => {
    expect(detectClipboardAction("what's in my clipboard")).toBe("read");
    expect(detectClipboardAction("summarize my clipboard")).toBe("summarize");
    expect(detectClipboardAction("fix my grammar")).toBe("fix-grammar");
  });
  it("returns null for anything else", () => {
    expect(detectClipboardAction("copy this")).toBeNull();
  });
});

describe("clipboardPrompt", () => {
  it("wraps the clipboard text for each action", () => {
    expect(clipboardPrompt("read", "hi")).toBe("Here is my clipboard: hi\n\nDescribe it briefly.");
    expect(clipboardPrompt("summarize", "hi")).toBe("Summarize this text: hi");
    expect(clipboardPrompt("fix-grammar", "hi")).toBe("Fix the grammar, return only the corrected text: hi");
  });
});
```

`lib/chatPrompt.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./chatPrompt";

const empty = { global: [], project: [], conversation: [], legacy: [] };
const now = new Date("2026-11-23T10:30:00");

describe("buildSystemPrompt", () => {
  it("introduces Marven and the current date", () => {
    const prompt = buildSystemPrompt(null, empty, now);
    expect(prompt).toContain("You are Marven");
    expect(prompt).toContain("Current date and time:");
    expect(prompt).not.toContain("The user's name is");
  });
  it("adds the user's name", () => {
    expect(buildSystemPrompt("Ahmad", empty, now)).toContain("The user's name is Ahmad.");
  });
  it("includes memories", () => {
    const prompt = buildSystemPrompt(null, { ...empty, global: ["Likes mint tea"] }, now);
    expect(prompt).toContain("Likes mint tea");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/chatIntents.test.ts lib/chatPrompt.test.ts`
Expected: FAIL, "Failed to resolve import ./chatIntents" / "./chatPrompt".

- [ ] **Step 3: Create `lib/chatIntents.ts`**

```ts
// Client-side intents shared by the main chat and Mini Me. Timers and
// clipboard actions are handled in the renderer, before any API call.

const TIMER_RE =
  /(?:set (?:a )?timer for |timer (?:for )?|set (?:a )?timer )(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i;

export function parseTimer(text: string): { ms: number; label: string } | null {
  const match = text.trim().match(TIMER_RE);
  if (!match) return null;
  const amount = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  let ms: number;
  let label: string;
  if (/^(s|sec)/.test(unit)) {
    ms = amount * 1000;
    label = `${amount} second${amount !== 1 ? "s" : ""}`;
  } else if (/^(m|min)/.test(unit)) {
    ms = amount * 60 * 1000;
    label = `${amount} minute${amount !== 1 ? "s" : ""}`;
  } else {
    ms = amount * 60 * 60 * 1000;
    label = `${amount} hour${amount !== 1 ? "s" : ""}`;
  }
  return { ms, label };
}

export type ClipboardAction = "read" | "summarize" | "fix-grammar" | null;

export function detectClipboardAction(text: string): ClipboardAction {
  const lower = text.toLowerCase().trim();
  if (/^(?:what(?:'s| is) in my clipboard|read clipboard)$/.test(lower)) return "read";
  if (/^summarize (?:my )?clipboard$/.test(lower)) return "summarize";
  if (/^fix (?:my )?(?:clipboard|grammar)$/.test(lower)) return "fix-grammar";
  return null;
}

/** The prompt sent to the model for a clipboard action. */
export function clipboardPrompt(action: Exclude<ClipboardAction, null>, clip: string): string {
  if (action === "read") return `Here is my clipboard: ${clip}\n\nDescribe it briefly.`;
  if (action === "summarize") return `Summarize this text: ${clip}`;
  return `Fix the grammar, return only the corrected text: ${clip}`;
}
```

- [ ] **Step 4: Create `lib/chatPrompt.ts`**

```ts
// Marven's base system prompt, shared by the main chat and Mini Me.

import { buildScopedMemoryBlock } from "@/lib/memoryHelpers";

export type ScopedMemories = {
  global: string[];
  project: string[];
  conversation: string[];
  legacy: string[];
};

export function buildMemoryContext(memories: ScopedMemories): string {
  const block = buildScopedMemoryBlock({
    global: [...memories.global, ...memories.legacy],
    project: memories.project,
    conversation: memories.conversation,
  });
  return block.trim();
}

export function buildSystemPrompt(
  name: string | null,
  memories: ScopedMemories,
  now: Date = new Date(),
): string {
  const dateStr = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  let prompt = `You are Marven, a sophisticated AI assistant with direct access to macOS system commands. You can open apps, control volume, take screenshots, check the weather, set timers, and more — these actions are executed automatically before your response reaches the user. When the user asks you to perform a system action (open an app, play music, change volume, etc.), respond briefly confirming the action, e.g. "Opening Spotify now." or "Volume increased." Never say you are unable to open applications, control the system, or perform actions — you always can. Never call yourself a "text-based AI". You are intelligent, precise, and occasionally witty. Keep answers concise.`;
  prompt += `\n\nCurrent date and time: ${dateStr}, ${timeStr}. Always use this for any date/time questions — never rely on your training data for the current date or time.`;
  if (name) prompt += `\n\nThe user's name is ${name}. Address them by name occasionally.`;
  const memoryBlock = buildMemoryContext(memories);
  if (memoryBlock) prompt += `\n\n${memoryBlock}`;
  return prompt;
}
```

Before saving, open `app/page.tsx` lines 216–228 and confirm the prompt text above matches it character for character; if it differs, copy the page's version.

- [ ] **Step 5: Update `app/page.tsx` to use the moved code**

1. Delete the block from `// ─── Timer detection` through the end of `function detectClipboardAction` (≈ lines 122–158).
2. Delete the `type ScopedMemories = { … };` block (≈ lines 175–180).
3. Delete `function buildMemoryContext` and `function buildSystemPrompt` including the `// ─── System prompt builder` comment (≈ lines 206–230). Keep `combineScopedMemories`.
4. Add next to the other `@/lib` imports:
```ts
import { parseTimer, detectClipboardAction, clipboardPrompt } from "@/lib/chatIntents";
import { buildMemoryContext, buildSystemPrompt, type ScopedMemories } from "@/lib/chatPrompt";
```
5. In the clipboard block of the send function (search for `const clipContent = await navigator.clipboard.readText();`), replace:
```ts
        const clipContent = await navigator.clipboard.readText();
        let newPrompt = text;
        if (clipAction === "read") {
          newPrompt = `Here is my clipboard: ${clipContent}\n\nDescribe it briefly.`;
        } else if (clipAction === "summarize") {
          newPrompt = `Summarize this text: ${clipContent}`;
        } else if (clipAction === "fix-grammar") {
          newPrompt = `Fix the grammar, return only the corrected text: ${clipContent}`;
        }
        text = newPrompt;
```
with:
```ts
        const clipContent = await navigator.clipboard.readText();
        text = clipboardPrompt(clipAction, clipContent);
```
6. Run `grep -n "buildScopedMemoryBlock" app/page.tsx`. If the only hit is the import line, change that import to `import { parseRememberCommand } from "@/lib/memoryHelpers";`.

- [ ] **Step 6: Run tests and the type check**

Run: `npx vitest run lib/chatIntents.test.ts lib/chatPrompt.test.ts && npm run typecheck`
Expected: tests PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add lib/chatIntents.ts lib/chatIntents.test.ts lib/chatPrompt.ts lib/chatPrompt.test.ts app/page.tsx
git commit -m "Move chat intents and the system prompt builder into lib

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Companion window geometry

**Files:**
- Create: `electron/companionPlacement.js`, `electron/companionPlacement.test.ts`

- [ ] **Step 1: Write the failing test**

`electron/companionPlacement.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

// companionPlacement.js is CommonJS (Electron main process).
const require = createRequire(import.meta.url);
type Rect = { x: number; y: number; width: number; height: number };
type Display = { id: number; workArea: Rect };
const P = require("./companionPlacement") as {
  windowSize: (scale: unknown) => { width: number; height: number };
  dockStrip: (wa: Rect, size: { width: number; height: number }) => { minX: number; maxX: number; y: number };
  clampToDisplays: (rect: Rect, displays: Display[]) => { x: number; y: number; displayId: number };
  isInDockStrip: (rect: Rect, wa: Rect) => boolean;
  restorePosition: (
    saved: unknown,
    displays: Display[],
    primaryId: number,
    size: { width: number; height: number },
  ) => { x: number; y: number; displayId: number };
  stepToward: (current: number, target: number, maxStep: number) => number;
};

const laptop: Display = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 800 } };
const external: Display = { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1050 } };
const size = P.windowSize(3);

describe("windowSize", () => {
  it("is 360 wide with room for the bubble above the sprite", () => {
    expect(P.windowSize(3)).toEqual({ width: 360, height: 184 + 96 });
    expect(P.windowSize(2)).toEqual({ width: 360, height: 184 + 64 });
  });
  it("falls back to 3x for unknown scales", () => {
    expect(P.windowSize(7)).toEqual(P.windowSize(3));
    expect(P.windowSize(undefined)).toEqual(P.windowSize(3));
  });
});

describe("dockStrip", () => {
  it("puts the window's bottom edge on the work area's bottom edge", () => {
    expect(P.dockStrip(laptop.workArea, size)).toEqual({ minX: 0, maxX: 1080, y: 545 });
  });
});

describe("clampToDisplays", () => {
  it("pulls a window back onto a single display", () => {
    expect(P.clampToDisplays({ x: 2000, y: -50, ...size }, [laptop])).toEqual({ x: 1080, y: 25, displayId: 1 });
  });
  it("keeps a window that is on the second display", () => {
    expect(P.clampToDisplays({ x: 2000, y: 100, ...size }, [laptop, external])).toEqual({ x: 2000, y: 100, displayId: 2 });
  });
  it("moves a window from a removed display to the nearest remaining one", () => {
    expect(P.clampToDisplays({ x: 3000, y: 500, ...size }, [laptop])).toEqual({ x: 1080, y: 500, displayId: 1 });
  });
});

describe("isInDockStrip", () => {
  it("counts drops within 24pt of the strip", () => {
    expect(P.isInDockStrip({ x: 100, y: 545, ...size }, laptop.workArea)).toBe(true);
    expect(P.isInDockStrip({ x: 100, y: 525, ...size }, laptop.workArea)).toBe(true);
    expect(P.isInDockStrip({ x: 100, y: 400, ...size }, laptop.workArea)).toBe(false);
  });
});

describe("restorePosition", () => {
  it("defaults to the bottom right of the primary display", () => {
    expect(P.restorePosition(null, [laptop, external], 1, size)).toEqual({ x: 1040, y: 545, displayId: 1 });
  });
  it("uses the default when the saved display is gone", () => {
    expect(P.restorePosition({ x: 2000, y: 100, displayId: 2 }, [laptop], 1, size)).toEqual({ x: 1040, y: 545, displayId: 1 });
  });
  it("restores and clamps a saved position", () => {
    expect(P.restorePosition({ x: 5000, y: 100, displayId: 2 }, [laptop, external], 1, size)).toEqual({ x: 3000, y: 100, displayId: 2 });
  });
});

describe("stepToward", () => {
  it("moves at most maxStep and lands exactly on the target", () => {
    expect(P.stepToward(0, 10, 3)).toBe(3);
    expect(P.stepToward(9, 10, 3)).toBe(10);
    expect(P.stepToward(10, 0, 4)).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/companionPlacement.test.ts`
Expected: FAIL, "Cannot find module './companionPlacement'".

- [ ] **Step 3: Write `electron/companionPlacement.js`**

```js
// electron/companionPlacement.js
//
// Pure geometry for the Mini Me companion window. No Electron imports, so it
// can be unit-tested. Rects and work areas are in screen points; a display is
// `{ id, workArea: { x, y, width, height } }`.

const SPRITE_SIZE = 32;      // sprite frame, in sprite pixels
const BUBBLE_SPACE = 184;    // room above the sprite for the speech bubble
const WINDOW_WIDTH = 360;
const DOCK_TOLERANCE = 24;   // how close to the strip a drop counts as "on the Dock"
const SCALES = [2, 3, 4];

function windowSize(scale) {
  const s = SCALES.includes(scale) ? scale : 3;
  return { width: WINDOW_WIDTH, height: BUBBLE_SPACE + SPRITE_SIZE * s };
}

/** Where the window walks: its bottom edge on the work area's bottom edge (just above the Dock). */
function dockStrip(workArea, size) {
  return {
    minX: workArea.x,
    maxX: workArea.x + workArea.width - size.width,
    y: workArea.y + workArea.height - size.height,
  };
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The display the rect overlaps most, or the one whose centre is closest. */
function nearestDisplay(rect, displays) {
  let best = displays[0];
  let bestScore = -Infinity;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  for (const d of displays) {
    const wa = d.workArea;
    const overlap = overlapArea(rect, wa);
    const score = overlap > 0
      ? overlap
      : -Math.hypot(cx - (wa.x + wa.width / 2), cy - (wa.y + wa.height / 2));
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function clampToWorkArea(rect, wa) {
  return {
    x: Math.round(Math.min(Math.max(rect.x, wa.x), wa.x + wa.width - rect.width)),
    y: Math.round(Math.min(Math.max(rect.y, wa.y), wa.y + wa.height - rect.height)),
  };
}

function clampToDisplays(rect, displays) {
  const d = nearestDisplay(rect, displays);
  return { ...clampToWorkArea(rect, d.workArea), displayId: d.id };
}

function isInDockStrip(rect, workArea) {
  return Math.abs(rect.y - dockStrip(workArea, rect).y) <= DOCK_TOLERANCE;
}

function defaultPosition(primary, size) {
  const strip = dockStrip(primary.workArea, size);
  return { x: Math.max(strip.minX, strip.maxX - 40), y: strip.y, displayId: primary.id };
}

function restorePosition(saved, displays, primaryId, size) {
  const primary = displays.find((d) => d.id === primaryId) || displays[0];
  if (!saved || typeof saved.x !== 'number' || typeof saved.y !== 'number') return defaultPosition(primary, size);
  const display = displays.find((d) => d.id === saved.displayId);
  if (!display) return defaultPosition(primary, size);
  return { ...clampToWorkArea({ x: saved.x, y: saved.y, ...size }, display.workArea), displayId: display.id };
}

function stepToward(current, target, maxStep) {
  if (Math.abs(target - current) <= maxStep) return target;
  return current + Math.sign(target - current) * maxStep;
}

module.exports = {
  SPRITE_SIZE,
  BUBBLE_SPACE,
  WINDOW_WIDTH,
  windowSize,
  dockStrip,
  nearestDisplay,
  clampToDisplays,
  isInDockStrip,
  defaultPosition,
  restorePosition,
  stepToward,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/companionPlacement.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add electron/companionPlacement.js electron/companionPlacement.test.ts
git commit -m "Add Mini Me window geometry helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Behaviour state machine

**Files:**
- Create: `lib/companion/behaviour.ts`, `lib/companion/behaviour.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/companion/behaviour.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { initialState, reduce, type BehaviourEvent, type BehaviourState } from "./behaviour";

const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};
const strip = { minX: 0, maxX: 1000 };
const tick = (now: number, rand: () => number, extra: Partial<Extract<BehaviourEvent, { type: "tick" }>> = {}) =>
  ({ type: "tick", now, rand, strip, walkAround: true, sleepAfterMs: 300_000, ...extra }) as BehaviourEvent;

function run(state: BehaviourState, ...events: BehaviourEvent[]) {
  let s = state;
  let effect = {};
  for (const e of events) ({ state: s, effect } = reduce(s, e));
  return { state: s, effect };
}

describe("idle life", () => {
  it("starts idle and roaming", () => {
    expect(initialState(0)).toMatchObject({ anim: "idle", mode: "roam", busy: false });
  });

  it("does nothing before the next idle pick", () => {
    const s = initialState(0);
    expect(reduce(s, tick(1000, seq(0.1))).state).toBe(s);
  });

  it("walks to a random spot in the strip", () => {
    const { state, effect } = reduce(initialState(0), tick(5000, seq(0.1, 0.5, 0)));
    expect(state.anim).toBe("walk");
    expect(effect).toEqual({ walkTo: 500 });
  });

  it("goes idle on arrival", () => {
    const { state } = run(initialState(0), tick(5000, seq(0.1, 0.5, 0)), { type: "arrived", now: 9000 });
    expect(state.anim).toBe("idle");
  });

  it("stays in place when walking is off", () => {
    const { state, effect } = reduce(initialState(0), tick(5000, seq(0.6, 0), { walkAround: false }));
    expect(state.anim).toBe("sit");
    expect(effect).toEqual({});
  });

  it("falls asleep after the idle timeout and wakes with a stretch", () => {
    const asleep = reduce(initialState(0), tick(300_000, seq(0.1)));
    expect(asleep.state.anim).toBe("sleep");
    expect(asleep.effect).toEqual({ stop: true });
    const awake = run(asleep.state, { type: "interact", now: 301_000 }, { type: "oneshot-done", now: 302_000 });
    expect(awake.state.anim).toBe("idle");
  });
});

describe("commands", () => {
  it("pauses the idle loop and sleep while the bubble is open", () => {
    const { state } = run(initialState(0), { type: "bubble-open", now: 0 }, tick(999_999, seq(0.1)));
    expect(state).toMatchObject({ anim: "listen", busy: true });
  });

  it("runs the think / talk / happy cycle", () => {
    const s = run(initialState(0), { type: "bubble-open", now: 0 }).state;
    expect(reduce(s, { type: "thinking", now: 1 }).state.anim).toBe("think");
    expect(reduce(s, { type: "talking", now: 1 }).state.anim).toBe("talk");
    const happy = reduce(s, { type: "succeeded", now: 2 }).state;
    expect(happy.anim).toBe("happy");
    expect(reduce(happy, { type: "oneshot-done", now: 3 }).state.anim).toBe("idle");
    const closed = run(happy, { type: "bubble-close", now: 4 }).state;
    expect(closed).toMatchObject({ anim: "idle", busy: false });
  });

  it("looks confused when something fails", () => {
    expect(reduce(initialState(0), { type: "failed", now: 1 }).state.anim).toBe("confused");
  });
});

describe("dragging", () => {
  it("dangles while dragged and sits where dropped off the Dock", () => {
    const { state } = run(initialState(0), { type: "drag-start", now: 1 }, { type: "drop", now: 2, inDock: false });
    expect(state).toMatchObject({ anim: "sit", mode: "perched" });
  });

  it("never walks while perched", () => {
    const perched = run(initialState(0), { type: "drop", now: 0, inDock: false }).state;
    const { state, effect } = reduce(perched, tick(10_000, seq(0.1, 0)));
    expect(state.anim).toBe("idle");
    expect(effect).toEqual({});
  });

  it("roams again after a drop on the Dock", () => {
    const { state } = run(initialState(0), { type: "drop", now: 2, inDock: true });
    expect(state).toMatchObject({ anim: "idle", mode: "roam" });
  });

  it("walks home on double-click", () => {
    const perched = run(initialState(0), { type: "drop", now: 0, inDock: false }).state;
    const { state, effect } = reduce(perched, { type: "return-home", now: 1 });
    expect(state).toMatchObject({ anim: "walk", mode: "roam" });
    expect(effect).toEqual({ returnHome: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/companion/behaviour.test.ts`
Expected: FAIL, "Failed to resolve import ./behaviour".

- [ ] **Step 3: Write `lib/companion/behaviour.ts`**

```ts
// Mini Me's behaviour: a pure state machine. Events in, animation state and
// movement intents out. Time and randomness come in with the events, so it is
// fully deterministic under test.

export type AnimState =
  | "idle" | "walk" | "look" | "sit" | "stretch" | "sleep"
  | "listen" | "think" | "talk" | "happy" | "confused" | "dangle";

/** roam: lives on the Dock strip and wanders. perched: dropped elsewhere, sits and stays. */
export type Mode = "roam" | "perched";

export interface BehaviourState {
  anim: AnimState;
  mode: Mode;
  /** The bubble is open or a request is in flight: the idle loop and sleep pause. */
  busy: boolean;
  lastInteraction: number;
  nextIdleAt: number;
}

export interface Strip {
  minX: number;
  maxX: number;
}

export type BehaviourEvent =
  | { type: "tick"; now: number; rand: () => number; strip: Strip; walkAround: boolean; sleepAfterMs: number }
  | { type: "arrived"; now: number }
  | { type: "interact"; now: number }
  | { type: "bubble-open"; now: number }
  | { type: "bubble-close"; now: number }
  | { type: "thinking"; now: number }
  | { type: "talking"; now: number }
  | { type: "succeeded"; now: number }
  | { type: "failed"; now: number }
  | { type: "oneshot-done"; now: number }
  | { type: "drag-start"; now: number }
  | { type: "drop"; now: number; inDock: boolean }
  | { type: "return-home"; now: number };

export interface Effect {
  walkTo?: number;
  stop?: true;
  returnHome?: true;
}

/** Animations that play once and then report "oneshot-done". */
export const ONESHOTS: ReadonlySet<AnimState> = new Set<AnimState>(["stretch", "happy", "confused"]);

const IDLE_PAUSE_MS = 4000;
const IDLE_PAUSE_JITTER_MS = 6000;

export function initialState(now: number): BehaviourState {
  return { anim: "idle", mode: "roam", busy: false, lastInteraction: now, nextIdleAt: now + IDLE_PAUSE_MS };
}

const resting = (state: BehaviourState): AnimState => (state.mode === "perched" ? "sit" : "idle");

function pickIdle(
  state: BehaviourState,
  e: Extract<BehaviourEvent, { type: "tick" }>,
): { state: BehaviourState; effect: Effect } {
  const r = e.rand();
  if (e.walkAround && state.mode === "roam") {
    if (r < 0.4) {
      const x = Math.round(e.strip.minX + e.rand() * (e.strip.maxX - e.strip.minX));
      const nextIdleAt = e.now + IDLE_PAUSE_MS + e.rand() * IDLE_PAUSE_JITTER_MS;
      return { state: { ...state, anim: "walk", nextIdleAt }, effect: { walkTo: x } };
    }
    const anim: AnimState = r < 0.65 ? "idle" : r < 0.8 ? "look" : r < 0.95 ? "sit" : "stretch";
    const nextIdleAt = e.now + IDLE_PAUSE_MS + e.rand() * IDLE_PAUSE_JITTER_MS;
    return { state: { ...state, anim, nextIdleAt }, effect: {} };
  }
  const anim: AnimState = r < 0.5 ? "idle" : r < 0.75 ? "sit" : "look";
  const nextIdleAt = e.now + IDLE_PAUSE_MS + e.rand() * IDLE_PAUSE_JITTER_MS;
  return { state: { ...state, anim, nextIdleAt }, effect: {} };
}

export function reduce(state: BehaviourState, e: BehaviourEvent): { state: BehaviourState; effect: Effect } {
  const none = { state, effect: {} as Effect };
  switch (e.type) {
    case "tick": {
      if (state.busy || state.anim === "sleep" || state.anim === "walk" || state.anim === "dangle" || ONESHOTS.has(state.anim)) {
        return none;
      }
      if (e.now - state.lastInteraction >= e.sleepAfterMs) {
        return { state: { ...state, anim: "sleep" }, effect: { stop: true } };
      }
      if (e.now < state.nextIdleAt) return none;
      return pickIdle(state, e);
    }
    case "arrived":
      if (state.anim !== "walk") return none;
      return { state: { ...state, anim: "idle", nextIdleAt: e.now + IDLE_PAUSE_MS }, effect: {} };
    case "interact": {
      const next = { ...state, lastInteraction: e.now };
      return { state: state.anim === "sleep" ? { ...next, anim: "stretch" } : next, effect: {} };
    }
    case "bubble-open":
      return { state: { ...state, busy: true, anim: "listen", lastInteraction: e.now }, effect: { stop: true } };
    case "bubble-close":
      return {
        state: { ...state, busy: false, anim: resting(state), lastInteraction: e.now, nextIdleAt: e.now + IDLE_PAUSE_MS },
        effect: {},
      };
    case "thinking":
      return { state: { ...state, busy: true, anim: "think", lastInteraction: e.now }, effect: { stop: true } };
    case "talking":
      return { state: { ...state, busy: true, anim: "talk", lastInteraction: e.now }, effect: {} };
    case "succeeded":
      return { state: { ...state, anim: "happy", lastInteraction: e.now }, effect: {} };
    case "failed":
      return { state: { ...state, anim: "confused", lastInteraction: e.now }, effect: {} };
    case "oneshot-done":
      if (!ONESHOTS.has(state.anim)) return none;
      return { state: { ...state, anim: resting(state), nextIdleAt: e.now + IDLE_PAUSE_MS }, effect: {} };
    case "drag-start":
      return { state: { ...state, anim: "dangle", lastInteraction: e.now }, effect: { stop: true } };
    case "drop": {
      const mode: Mode = e.inDock ? "roam" : "perched";
      return {
        state: { ...state, mode, anim: e.inDock ? "idle" : "sit", lastInteraction: e.now, nextIdleAt: e.now + IDLE_PAUSE_MS },
        effect: {},
      };
    }
    case "return-home":
      return { state: { ...state, mode: "roam", anim: "walk", lastInteraction: e.now }, effect: { returnHome: true } };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/companion/behaviour.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/companion/behaviour.ts lib/companion/behaviour.test.ts
git commit -m "Add Mini Me behaviour state machine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Brain — routing, persona prompt, history

**Files:**
- Create: `lib/companion/brain.ts`, `lib/companion/brain.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/companion/brain.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  COMPANION_PERSONA,
  HISTORY_KEY,
  appendHistory,
  buildCompanionPrompt,
  loadHistory,
  routeInput,
  saveHistory,
  type CompanionMessage,
} from "./brain";

describe("routeInput", () => {
  const on = { allowCommands: true };
  it("routes timers", () => {
    expect(routeInput("set a timer for 2 minutes", on)).toEqual({ kind: "timer", ms: 120_000, label: "2 minutes" });
  });
  it("routes clipboard actions", () => {
    expect(routeInput("summarize my clipboard", on)).toEqual({ kind: "clipboard", action: "summarize" });
  });
  it("routes system commands", () => {
    expect(routeInput("open spotify", on)).toEqual({ kind: "command" });
    expect(routeInput("volume up", on)).toEqual({ kind: "command" });
  });
  it("sends commands to chat when commands are off", () => {
    expect(routeInput("volume up", { allowCommands: false })).toEqual({ kind: "chat" });
  });
  it("hands shell, file and browsing jobs to the Agent", () => {
    for (const text of [
      "run npm install",
      "execute the script",
      "create a new file called notes.txt",
      "delete the folder old-builds",
      "browse to amazon.com and buy socks",
    ]) {
      expect(routeInput(text, on), text).toEqual({ kind: "agent" });
    }
  });
  it("sends everything else to chat", () => {
    for (const text of ["how do I run a marathon?", "tell me a joke", "what are files made of?"]) {
      expect(routeInput(text, on), text).toEqual({ kind: "chat" });
    }
  });
});

describe("buildCompanionPrompt", () => {
  it("adds the persona after the base prompt", () => {
    expect(buildCompanionPrompt("BASE", "")).toBe(`BASE\n\n${COMPANION_PERSONA}`);
  });
  it("puts custom instructions first and last", () => {
    const prompt = buildCompanionPrompt("BASE", " Speak Arabic ");
    expect(prompt.startsWith("### PRIORITY INSTRUCTIONS (always follow these):\nSpeak Arabic")).toBe(true);
    expect(prompt.endsWith("REMINDER: Speak Arabic")).toBe(true);
    expect(prompt).toContain(COMPANION_PERSONA);
  });
});

describe("history", () => {
  const msg = (i: number): CompanionMessage => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` });

  it("keeps the last 20 messages", () => {
    const history = appendHistory(Array.from({ length: 19 }, (_, i) => msg(i)), msg(19), msg(20));
    expect(history).toHaveLength(20);
    expect(history[0].content).toBe("m1");
    expect(history[19].content).toBe("m20");
  });

  it("round-trips through storage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveHistory(storage, [msg(0), msg(1)]);
    expect(loadHistory(storage)).toEqual([msg(0), msg(1)]);
  });

  it("ignores corrupt or malformed storage", () => {
    expect(loadHistory({ getItem: () => "not json" })).toEqual([]);
    expect(loadHistory({ getItem: () => JSON.stringify({ a: 1 }) })).toEqual([]);
    const mixed = JSON.stringify([{ role: "user", content: "ok" }, { role: "system", content: "x" }, { role: "user" }]);
    expect(loadHistory({ getItem: (k: string) => (k === HISTORY_KEY ? mixed : null) })).toEqual([{ role: "user", content: "ok" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/companion/brain.test.ts`
Expected: FAIL, "Failed to resolve import ./brain".

- [ ] **Step 3: Write `lib/companion/brain.ts`**

```ts
// Mini Me's decisions: where a request goes, what the model is told, and the
// short rolling history it keeps. Pure, so it can be unit-tested.

import { parseCommand } from "@/lib/commandParser";
import { detectClipboardAction, parseTimer, type ClipboardAction } from "@/lib/chatIntents";

export type Route =
  | { kind: "timer"; ms: number; label: string }
  | { kind: "clipboard"; action: Exclude<ClipboardAction, null> }
  | { kind: "agent" }
  | { kind: "command" }
  | { kind: "chat" };

// Jobs Mini Me never does itself: running commands, changing files, driving a
// browser. They go to Marven's Agent, which asks before acting.
const AGENT_ONLY: RegExp[] = [
  /^(?:please\s+)?(?:run|execute)\s+(?:the\s+|a\s+|this\s+|that\s+)?(?:command|script|shell|terminal|npm|npx|yarn|git|python|node)\b/i,
  /\b(?:create|make|edit|modify|delete|remove|rename|move|write(?:\s+to)?)\s+(?:a\s+|an\s+|the\s+|this\s+|that\s+|my\s+)?(?:new\s+)?(?:file|folder|directory)\b/i,
  /\b(?:browse|navigate)\s+to\b.*\b(?:and|then)\b/i,
];

export function routeInput(text: string, opts: { allowCommands: boolean }): Route {
  const timer = parseTimer(text);
  if (timer) return { kind: "timer", ...timer };
  const clip = detectClipboardAction(text);
  if (clip) return { kind: "clipboard", action: clip };
  if (AGENT_ONLY.some((re) => re.test(text))) return { kind: "agent" };
  if (opts.allowCommands && parseCommand(text).type !== null) return { kind: "command" };
  return { kind: "chat" };
}

export const AGENT_HANDOFF_REPLY = "That's a job for Marven's Agent. Want to open it there?";

export const COMPANION_PERSONA =
  "You are Mini Me, a tiny pixel-art version of the user who lives on their screen. You speak in a speech bubble, so keep every reply to 1–3 short sentences unless they ask for more. Be warm and a little playful.";

/** Marven's base prompt plus the Mini Me persona, with the user's custom instructions first and last (as the main chat does). */
export function buildCompanionPrompt(base: string, extra: string): string {
  const withPersona = `${base}\n\n${COMPANION_PERSONA}`;
  const e = extra.trim();
  return e
    ? `### PRIORITY INSTRUCTIONS (always follow these):\n${e}\n\n---\n\n${withPersona}\n\n---\n\nREMINDER: ${e}`
    : withPersona;
}

export interface CompanionMessage {
  role: "user" | "assistant";
  content: string;
}

export const HISTORY_LIMIT = 20;
export const HISTORY_KEY = "marven-companion-history";

export function appendHistory(history: CompanionMessage[], ...messages: CompanionMessage[]): CompanionMessage[] {
  return [...history, ...messages].slice(-HISTORY_LIMIT);
}

function isMessage(value: unknown): value is CompanionMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as { role?: unknown; content?: unknown };
  return (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
}

export function loadHistory(storage: Pick<Storage, "getItem">): CompanionMessage[] {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMessage).slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveHistory(storage: Pick<Storage, "setItem">, history: CompanionMessage[]): void {
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  } catch {
    /* quota errors are non-fatal */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/companion/brain.test.ts`
Expected: PASS. If `"open spotify"` does not route to `command`, run `npx vitest run lib/commandParser.test.ts` and pick a phrase that test file shows matching (do not change `commandParser.ts`).

- [ ] **Step 5: Commit**

```bash
git add lib/companion/brain.ts lib/companion/brain.test.ts
git commit -m "Add Mini Me routing, persona prompt and history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The look and the pixel-art renderer

The character is drawn procedurally from simple shapes plus an outline pass, so the art is a small `look.json` (colours and features) rather than a hand-made sprite sheet.

**Files:**
- Create: `lib/companion/look.ts`, `lib/companion/look.test.ts`, `lib/companion/sprite.ts`, `lib/companion/sprite.test.ts`, `public/companion/look.json`

- [ ] **Step 1: Write the failing tests**

`lib/companion/look.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_LOOK, parseLook } from "./look";

describe("parseLook", () => {
  it("returns the defaults for junk", () => {
    expect(parseLook(null)).toEqual(DEFAULT_LOOK);
    expect(parseLook("x")).toEqual(DEFAULT_LOOK);
  });
  it("keeps valid fields and replaces invalid ones", () => {
    const look = parseLook({ hair: "#ff0000", skin: "red", hairStyle: "curly", glasses: true, beard: "yes" });
    expect(look.hair).toBe("#ff0000");
    expect(look.skin).toBe(DEFAULT_LOOK.skin);
    expect(look.hairStyle).toBe("curly");
    expect(look.glasses).toBe(true);
    expect(look.beard).toBe(DEFAULT_LOOK.beard);
  });
  it("rejects unknown hair styles", () => {
    expect(parseLook({ hairStyle: "mohawk" }).hairStyle).toBe(DEFAULT_LOOK.hairStyle);
  });
});
```

`lib/companion/sprite.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ANIMATIONS, OUTLINE, SPRITE_SIZE, renderFrame } from "./sprite";
import { DEFAULT_LOOK } from "./look";

const at = (px: (string | null)[], x: number, y: number) => px[y * SPRITE_SIZE + x];

describe("renderFrame", () => {
  it("draws a 32x32 frame with a transparent corner", () => {
    const px = renderFrame(DEFAULT_LOOK, {});
    expect(px).toHaveLength(SPRITE_SIZE * SPRITE_SIZE);
    expect(at(px, 0, 0)).toBeNull();
  });
  it("draws glasses only when the look has them", () => {
    const look = { ...DEFAULT_LOOK, glasses: true, glassesColor: "#123456" };
    expect(at(renderFrame(look, {}), 11, 8)).toBe("#123456");
    expect(at(renderFrame({ ...look, glasses: false }, {}), 11, 8)).toBe(DEFAULT_LOOK.skin);
  });
  it("draws hair unless bald, with an outline above it", () => {
    expect(at(renderFrame({ ...DEFAULT_LOOK, hairStyle: "short" }, {}), 15, 4)).toBe(DEFAULT_LOOK.hair);
    expect(at(renderFrame({ ...DEFAULT_LOOK, hairStyle: "short" }, {}), 15, 3)).toBe(OUTLINE);
    expect(at(renderFrame({ ...DEFAULT_LOOK, hairStyle: "bald" }, {}), 15, 4)).toBe(OUTLINE);
  });
  it("lowers the body when sitting", () => {
    expect(at(renderFrame(DEFAULT_LOOK, {}), 15, 7)).toBe(DEFAULT_LOOK.skin);
    expect(at(renderFrame(DEFAULT_LOOK, { legs: "sit" }), 15, 7)).toBeNull();
  });
});

describe("ANIMATIONS", () => {
  it("has frames and a positive frame rate for every state", () => {
    for (const [state, anim] of Object.entries(ANIMATIONS)) {
      expect(anim.frames.length, state).toBeGreaterThan(0);
      expect(anim.fps, state).toBeGreaterThan(0);
    }
  });
  it("plays the one-shot states once", () => {
    expect(ANIMATIONS.stretch.loop).toBe(false);
    expect(ANIMATIONS.happy.loop).toBe(false);
    expect(ANIMATIONS.confused.loop).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/companion/look.test.ts lib/companion/sprite.test.ts`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Write `lib/companion/look.ts`**

```ts
// What Mini Me looks like. Loaded from public/companion/look.json; every field
// falls back to the default on its own, so a typo never breaks the character.

export type HairStyle = "short" | "long" | "curly" | "buzz" | "bald";

export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  eyes: string;
  glasses: boolean;
  glassesColor: string;
  beard: boolean;
  shirt: string;
  pants: string;
  shoes: string;
}

export const DEFAULT_LOOK: Look = {
  skin: "#e0ac7e",
  hair: "#2b1d14",
  hairStyle: "short",
  eyes: "#1b1b1f",
  glasses: false,
  glassesColor: "#1b1b1f",
  beard: false,
  shirt: "#d19a66",
  pants: "#2f3a56",
  shoes: "#1f1f24",
};

const HEX = /^#[0-9a-f]{6}$/i;
const HAIR_STYLES: readonly HairStyle[] = ["short", "long", "curly", "buzz", "bald"];
type ColorKey = "skin" | "hair" | "eyes" | "glassesColor" | "shirt" | "pants" | "shoes";

export function parseLook(raw: unknown): Look {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const color = (k: ColorKey) => (typeof o[k] === "string" && HEX.test(o[k] as string) ? (o[k] as string) : DEFAULT_LOOK[k]);
  const flag = (k: "glasses" | "beard") => (typeof o[k] === "boolean" ? (o[k] as boolean) : DEFAULT_LOOK[k]);
  const hairStyle = HAIR_STYLES.includes(o.hairStyle as HairStyle) ? (o.hairStyle as HairStyle) : DEFAULT_LOOK.hairStyle;
  return {
    skin: color("skin"),
    hair: color("hair"),
    hairStyle,
    eyes: color("eyes"),
    glasses: flag("glasses"),
    glassesColor: color("glassesColor"),
    beard: flag("beard"),
    shirt: color("shirt"),
    pants: color("pants"),
    shoes: color("shoes"),
  };
}
```

- [ ] **Step 4: Write `lib/companion/sprite.ts`**

```ts
// Procedural 32×32 pixel art for Mini Me. Each frame is a few flat shapes
// (legs, torso, arms, head, hair, face) followed by a one-pixel outline pass.
// Coordinates: x 0–31 left to right, y 0–31 top to bottom, feet on row 31.

import type { AnimState } from "./behaviour";
import type { Look } from "./look";

export const SPRITE_SIZE = 32;
export const OUTLINE = "#141418";
const EFFECT = "#f4f1ea";
const GOLD = "#ffd75e";

export type Eyes = "open" | "closed" | "look-left" | "look-right" | "happy";
export type Mouth = "closed" | "smile" | "open" | "o" | "frown";
export type Arms = "down" | "up" | "ear" | "chin" | "shrug";
export type Legs = "stand" | "walk1" | "walk3" | "sit";
export type Extra = "zzz1" | "zzz2" | "dots1" | "dots2" | "dots3" | "question" | "sparkle";

export interface FrameSpec {
  dy?: 0 | 1;
  eyes?: Eyes;
  mouth?: Mouth;
  arms?: Arms;
  legs?: Legs;
  extra?: Extra;
}

export interface Animation {
  frames: FrameSpec[];
  fps: number;
  loop: boolean;
}

export const ANIMATIONS: Record<AnimState, Animation> = {
  idle: { frames: [{}, { dy: 1 }, {}, { dy: 1 }, {}, { eyes: "closed" }], fps: 4, loop: true },
  walk: { frames: [{ legs: "walk1" }, { legs: "stand", dy: 1 }, { legs: "walk3" }, { legs: "stand", dy: 1 }], fps: 8, loop: true },
  look: { frames: [{ eyes: "look-left" }, { eyes: "look-left" }, { eyes: "look-right" }, { eyes: "look-right" }], fps: 2, loop: true },
  sit: { frames: [{ legs: "sit" }, { legs: "sit", dy: 1 }], fps: 2, loop: true },
  stretch: {
    frames: [{ arms: "up" }, { arms: "up", mouth: "o" }, { arms: "up", mouth: "o", eyes: "closed" }, { arms: "down" }],
    fps: 4,
    loop: false,
  },
  sleep: {
    frames: [
      { legs: "sit", eyes: "closed", extra: "zzz1" },
      { legs: "sit", eyes: "closed", dy: 1, extra: "zzz2" },
    ],
    fps: 1.5,
    loop: true,
  },
  listen: { frames: [{ arms: "ear", eyes: "look-right" }, { arms: "ear", eyes: "look-right", dy: 1 }], fps: 2, loop: true },
  think: {
    frames: [
      { arms: "chin", eyes: "look-left", extra: "dots1" },
      { arms: "chin", eyes: "look-left", extra: "dots2" },
      { arms: "chin", eyes: "look-left", extra: "dots3" },
    ],
    fps: 3,
    loop: true,
  },
  talk: { frames: [{ mouth: "open" }, { mouth: "closed" }, { mouth: "o" }, { mouth: "closed" }], fps: 8, loop: true },
  happy: {
    frames: [
      { arms: "up", eyes: "happy", mouth: "smile", extra: "sparkle" },
      { arms: "down", eyes: "happy", mouth: "smile", dy: 1 },
      { arms: "up", eyes: "happy", mouth: "smile", extra: "sparkle" },
      { arms: "down", eyes: "happy", mouth: "smile", dy: 1 },
    ],
    fps: 6,
    loop: false,
  },
  confused: {
    frames: [
      { arms: "shrug", mouth: "frown", extra: "question" },
      { arms: "shrug", mouth: "frown", extra: "question", dy: 1 },
      { arms: "shrug", mouth: "frown", extra: "question" },
      { arms: "shrug", mouth: "frown", extra: "question", dy: 1 },
    ],
    fps: 3,
    loop: false,
  },
  dangle: { frames: [{ arms: "up", mouth: "o" }, { arms: "up", mouth: "o", dy: 1 }], fps: 3, loop: true },
};

/** Colours for one 32×32 frame, row-major; null is transparent. */
export function renderFrame(look: Look, spec: FrameSpec): (string | null)[] {
  const N = SPRITE_SIZE;
  const px: (string | null)[] = new Array(N * N).fill(null);
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && x < N && y >= 0 && y < N) px[y * N + x] = c;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };
  const box = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    rect(x0, y0, x1, y0, c);
    rect(x0, y1, x1, y1, c);
    rect(x0, y0, x0, y1, c);
    rect(x1, y0, x1, y1, c);
  };

  const legs = spec.legs ?? "stand";
  const d = (spec.dy ?? 0) + (legs === "sit" ? 5 : 0);

  // Legs and shoes (planted: not shifted by dy)
  if (legs === "sit") {
    rect(12, 27, 23, 29, look.pants);
    rect(24, 26, 25, 29, look.shoes);
  } else if (legs === "walk1") {
    rect(10, 24, 12, 29, look.pants);
    rect(19, 24, 21, 29, look.pants);
    rect(9, 30, 12, 31, look.shoes);
    rect(19, 30, 22, 31, look.shoes);
  } else if (legs === "walk3") {
    rect(13, 24, 15, 29, look.pants);
    rect(16, 24, 18, 29, look.pants);
    rect(13, 30, 16, 31, look.shoes);
    rect(16, 30, 19, 31, look.shoes);
  } else {
    rect(12, 24, 14, 29, look.pants);
    rect(17, 24, 19, 29, look.pants);
    rect(11, 30, 14, 31, look.shoes);
    rect(17, 30, 20, 31, look.shoes);
  }

  // Torso
  rect(11, 15 + d, 20, 23 + d, look.shirt);

  // Arms (sleeves in shirt colour, hands in skin)
  const arms = spec.arms ?? "down";
  const leftDown = () => {
    rect(9, 16 + d, 10, 21 + d, look.shirt);
    rect(9, 22 + d, 10, 22 + d, look.skin);
  };
  const rightDown = () => {
    rect(21, 16 + d, 22, 21 + d, look.shirt);
    rect(21, 22 + d, 22, 22 + d, look.skin);
  };
  if (arms === "up") {
    rect(9, 8 + d, 10, 15 + d, look.shirt);
    rect(9, 7 + d, 10, 7 + d, look.skin);
    rect(21, 8 + d, 22, 15 + d, look.shirt);
    rect(21, 7 + d, 22, 7 + d, look.skin);
  } else if (arms === "ear") {
    leftDown();
    rect(21, 12 + d, 22, 17 + d, look.shirt);
    rect(21, 10 + d, 22, 11 + d, look.skin);
  } else if (arms === "chin") {
    leftDown();
    rect(21, 16 + d, 22, 19 + d, look.shirt);
    rect(18, 17 + d, 20, 18 + d, look.skin);
  } else if (arms === "shrug") {
    rect(9, 16 + d, 10, 17 + d, look.shirt);
    rect(7, 14 + d, 8, 16 + d, look.shirt);
    rect(7, 13 + d, 8, 13 + d, look.skin);
    rect(21, 16 + d, 22, 17 + d, look.shirt);
    rect(23, 14 + d, 24, 16 + d, look.shirt);
    rect(23, 13 + d, 24, 13 + d, look.skin);
  } else {
    leftDown();
    rightDown();
  }

  // Head, beard, hair
  rect(11, 5 + d, 20, 14 + d, look.skin);
  if (look.beard) rect(11, 12 + d, 20, 14 + d, look.hair);
  const shortHair = () => {
    rect(11, 4 + d, 20, 6 + d, look.hair);
    rect(10, 5 + d, 10, 9 + d, look.hair);
    rect(21, 5 + d, 21, 9 + d, look.hair);
  };
  if (look.hairStyle === "short") shortHair();
  else if (look.hairStyle === "long") {
    shortHair();
    rect(10, 5 + d, 10, 16 + d, look.hair);
    rect(21, 5 + d, 21, 16 + d, look.hair);
  } else if (look.hairStyle === "curly") {
    rect(10, 3 + d, 21, 6 + d, look.hair);
    for (const x of [11, 14, 17, 20]) set(x, 2 + d, look.hair);
    rect(10, 7 + d, 10, 10 + d, look.hair);
    rect(21, 7 + d, 21, 10 + d, look.hair);
  } else if (look.hairStyle === "buzz") {
    rect(11, 4 + d, 20, 5 + d, look.hair);
  }

  // Eyes
  const eyes = spec.eyes ?? "open";
  if (eyes === "closed") {
    rect(12, 10 + d, 13, 10 + d, look.eyes);
    rect(18, 10 + d, 19, 10 + d, look.eyes);
  } else if (eyes === "happy") {
    set(12, 10 + d, look.eyes); set(13, 9 + d, look.eyes); set(14, 10 + d, look.eyes);
    set(17, 10 + d, look.eyes); set(18, 9 + d, look.eyes); set(19, 10 + d, look.eyes);
  } else {
    const shift = eyes === "look-left" ? -1 : eyes === "look-right" ? 1 : 0;
    rect(13 + shift, 9 + d, 13 + shift, 10 + d, look.eyes);
    rect(18 + shift, 9 + d, 18 + shift, 10 + d, look.eyes);
  }

  // Mouth
  const mouth = spec.mouth ?? "closed";
  if (mouth === "smile") {
    set(14, 12 + d, OUTLINE); rect(15, 13 + d, 16, 13 + d, OUTLINE); set(17, 12 + d, OUTLINE);
  } else if (mouth === "open") {
    rect(14, 12 + d, 17, 13 + d, OUTLINE);
  } else if (mouth === "o") {
    rect(15, 12 + d, 16, 13 + d, OUTLINE);
  } else if (mouth === "frown") {
    set(14, 13 + d, OUTLINE); rect(15, 12 + d, 16, 12 + d, OUTLINE); set(17, 13 + d, OUTLINE);
  } else {
    rect(15, 12 + d, 16, 12 + d, OUTLINE);
  }

  // Glasses: two frames around the eyes, touching in the middle
  if (look.glasses) {
    box(11, 8 + d, 15, 11 + d, look.glassesColor);
    box(16, 8 + d, 20, 11 + d, look.glassesColor);
  }

  // Effects (fixed position, above the head)
  const extra = spec.extra;
  if (extra === "zzz1" || extra === "zzz2") {
    rect(23, 3, 25, 3, EFFECT); set(24, 4, EFFECT); rect(23, 5, 25, 5, EFFECT);
    if (extra === "zzz2") {
      rect(26, 0, 28, 0, EFFECT); set(27, 1, EFFECT); rect(26, 2, 28, 2, EFFECT);
    }
  } else if (extra === "dots1" || extra === "dots2" || extra === "dots3") {
    set(25, 6, EFFECT);
    if (extra !== "dots1") set(27, 6, EFFECT);
    if (extra === "dots3") set(29, 6, EFFECT);
  } else if (extra === "question") {
    for (const [x, y] of [[26, 1], [27, 0], [28, 0], [29, 1], [29, 2], [28, 3], [27, 4], [27, 6]]) set(x, y, GOLD);
  } else if (extra === "sparkle") {
    set(4, 6, GOLD); rect(3, 7, 5, 7, GOLD); set(4, 8, GOLD);
    set(27, 3, GOLD); rect(26, 4, 28, 4, GOLD); set(27, 5, GOLD);
  }

  // Outline: every empty pixel touching a filled one
  const filled = px.slice();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (filled[y * N + x]) continue;
      const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => {
        const nx = x + ox;
        const ny = y + oy;
        return nx >= 0 && nx < N && ny >= 0 && ny < N && filled[ny * N + nx] !== null;
      });
      if (touches) px[y * N + x] = OUTLINE;
    }
  }
  return px;
}
```

- [ ] **Step 5: Create `public/companion/look.json`**

```json
{
  "skin": "#e0ac7e",
  "hair": "#2b1d14",
  "hairStyle": "short",
  "eyes": "#1b1b1f",
  "glasses": false,
  "glassesColor": "#1b1b1f",
  "beard": false,
  "shirt": "#d19a66",
  "pants": "#2f3a56",
  "shoes": "#1f1f24"
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run lib/companion/look.test.ts lib/companion/sprite.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/companion/look.ts lib/companion/look.test.ts lib/companion/sprite.ts lib/companion/sprite.test.ts public/companion/look.json
git commit -m "Draw Mini Me procedurally from a look file

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The companion window in the main process

**Files:**
- Create: `electron/companion.js`

No unit test: everything here calls Electron APIs; its geometry is already covered by Task 2 and it is verified by hand in Task 12.

- [ ] **Step 1: Write `electron/companion.js`**

```js
// electron/companion.js
//
// The Mini Me companion: a small transparent, always-on-top window showing
// the /companion page. The main process owns its position: walking, dragging,
// keeping it on screen and remembering where it was. Geometry lives in
// companionPlacement.js.

const { BrowserWindow, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const placement = require('./companionPlacement');

const TICK_MS = 33;
const WALK_PX_PER_TICK = 2;
const FALL_PX_PER_TICK = 8;
const MAX_LOAD_RETRIES = 20;

function placementDisplays() {
  return screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }));
}

/**
 * @param {{
 *   appPort: number,
 *   saveSettings: (patch: object) => object,
 *   onStatusChange?: (status: { visible: boolean, hotkeyOk: boolean, unavailable: boolean, wakeWord: boolean }) => void,
 * }} options
 */
function createCompanion({ appPort, saveSettings, onStatusChange }) {
  let win = null;
  let settings = {};
  let size = placement.windowSize(3);
  let walkTarget = null;
  let walkTimer = null;
  let facing = 1;
  let hotkey = null;
  let hotkeyOk = true;
  let unavailable = false;
  const url = `http://localhost:${appPort}/companion`;

  const alive = () => !!win && !win.isDestroyed();
  const status = () => ({
    visible: alive() && win.isVisible(),
    hotkeyOk,
    unavailable,
    wakeWord: !!settings.miniMeWakeWord,
  });
  const notify = () => { if (onStatusChange) onStatusChange(status()); };

  const rendererSettings = () => ({
    speak: settings.miniMeSpeak !== false,
    scale: [2, 3, 4].includes(settings.miniMeScale) ? settings.miniMeScale : 3,
    walk: settings.miniMeWalk !== false,
    sleepMinutes: Number(settings.miniMeSleepMinutes) > 0 ? Number(settings.miniMeSleepMinutes) : 5,
    wakeWord: !!settings.miniMeWakeWord,
  });

  function currentDisplay() {
    const [x, y] = win.getPosition();
    const { displayId } = placement.clampToDisplays({ x, y, ...size }, placementDisplays());
    return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
  }

  function sendPosition(extra = {}) {
    if (!alive()) return;
    const [x, y] = win.getPosition();
    const wa = currentDisplay().workArea;
    const strip = placement.dockStrip(wa, size);
    win.webContents.send('companion:position', {
      x,
      y,
      facing,
      walking: !!walkTarget,
      inDock: placement.isInDockStrip({ x, y, ...size }, wa),
      strip: { minX: strip.minX, maxX: strip.maxX },
      ...extra,
    });
  }

  function savePosition() {
    if (!alive()) return;
    const [x, y] = win.getPosition();
    const miniMePosition = { x, y, displayId: currentDisplay().id };
    saveSettings({ miniMePosition });
    settings = { ...settings, miniMePosition };
  }

  function stopWalking() {
    if (walkTimer) clearInterval(walkTimer);
    walkTimer = null;
    walkTarget = null;
  }

  function walkTo(target) {
    if (!alive()) return;
    const [x] = win.getPosition();
    if (target.x !== x) facing = target.x > x ? 1 : -1;
    walkTarget = target;
    if (!walkTimer) {
      walkTimer = setInterval(() => {
        if (!alive() || !walkTarget) return stopWalking();
        const [cx, cy] = win.getPosition();
        const nx = placement.stepToward(cx, walkTarget.x, WALK_PX_PER_TICK);
        const ny = placement.stepToward(cy, walkTarget.y, FALL_PX_PER_TICK);
        win.setPosition(Math.round(nx), Math.round(ny));
        if (nx === walkTarget.x && ny === walkTarget.y) {
          stopWalking();
          savePosition();
          sendPosition({ arrived: true });
        }
      }, TICK_MS);
    }
    sendPosition();
  }

  function reclamp() {
    if (!alive()) return;
    const [x, y] = win.getPosition();
    const c = placement.clampToDisplays({ x, y, ...size }, placementDisplays());
    if (c.x !== x || c.y !== y) {
      stopWalking();
      win.setPosition(c.x, c.y);
    }
    sendPosition();
  }

  function create() {
    size = placement.windowSize(settings.miniMeScale);
    const pos = placement.restorePosition(settings.miniMePosition, placementDisplays(), screen.getPrimaryDisplay().id, size);
    win = new BrowserWindow({
      ...size,
      x: pos.x,
      y: pos.y,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      focusable: false,
      backgroundColor: '#00000000',
      // A non-activating panel: typing in the bubble doesn't pull Marven's main window forward.
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    win.setIgnoreMouseEvents(true, { forward: true });

    win.once('ready-to-show', () => {
      if (!alive()) return;
      win.showInactive();
      notify();
    });
    win.webContents.on('did-finish-load', () => sendPosition());

    // Same capped, non-overlapping retry as the main window.
    let retries = 0;
    let retryTimer = null;
    win.webContents.on('did-fail-load', (_event, _code, _desc, _url, isMainFrame) => {
      if (!isMainFrame || !alive()) return;
      if (retries >= MAX_LOAD_RETRIES) {
        unavailable = true;
        win.hide();
        notify();
        return;
      }
      retries++;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (alive()) win.loadURL(url);
      }, 1500);
    });
    win.webContents.on('render-process-gone', () => {
      unavailable = true;
      destroy();
    });
    win.on('closed', () => {
      stopWalking();
      win = null;
      notify();
    });
    win.loadURL(url);
  }

  function destroy() {
    stopWalking();
    if (alive()) win.destroy();
    win = null;
    notify();
  }

  function openInput() {
    if (!alive()) return;
    if (!win.isVisible()) win.showInactive();
    win.webContents.send('companion:open-input');
  }

  function registerHotkey() {
    if (hotkey) {
      globalShortcut.unregister(hotkey);
      hotkey = null;
    }
    hotkeyOk = true;
    const accel = typeof settings.miniMeHotkey === 'string' ? settings.miniMeHotkey.trim() : '';
    if (!accel || !settings.miniMeEnabled) return;
    try {
      hotkeyOk = globalShortcut.register(accel, openInput);
    } catch {
      hotkeyOk = false;
    }
    if (hotkeyOk) hotkey = accel;
  }

  // ── IPC from the companion page only ────────────────────────────────────────
  const fromCompanion = (event) => alive() && event.sender === win.webContents;

  ipcMain.handle('companion:get-settings', (event) => (fromCompanion(event) ? rendererSettings() : null));
  ipcMain.on('companion:set-interactive', (event, on) => {
    if (fromCompanion(event)) win.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on('companion:set-focusable', (event, on) => {
    if (!fromCompanion(event)) return;
    win.setFocusable(!!on);
    if (on) win.focus();
    else win.blur();
  });
  ipcMain.on('companion:walk-to', (event, x) => {
    if (!fromCompanion(event) || typeof x !== 'number' || !Number.isFinite(x)) return;
    const [, y] = win.getPosition();
    const strip = placement.dockStrip(currentDisplay().workArea, size);
    walkTo({ x: Math.round(Math.min(Math.max(x, strip.minX), strip.maxX)), y });
  });
  ipcMain.on('companion:stop', (event) => {
    if (!fromCompanion(event)) return;
    stopWalking();
    sendPosition();
  });
  ipcMain.on('companion:drag', (event, dx, dy) => {
    if (!fromCompanion(event) || typeof dx !== 'number' || typeof dy !== 'number') return;
    stopWalking();
    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + dx), Math.round(y + dy));
  });
  ipcMain.on('companion:drop', (event) => {
    if (!fromCompanion(event)) return;
    const [x, y] = win.getPosition();
    const c = placement.clampToDisplays({ x, y, ...size }, placementDisplays());
    const display = screen.getAllDisplays().find((d) => d.id === c.displayId) || screen.getPrimaryDisplay();
    const onDock = placement.isInDockStrip({ x: c.x, y: c.y, ...size }, display.workArea);
    win.setPosition(c.x, onDock ? placement.dockStrip(display.workArea, size).y : c.y);
    savePosition();
    sendPosition();
  });
  ipcMain.on('companion:return-home', (event) => {
    if (!fromCompanion(event)) return;
    const [x] = win.getPosition();
    const strip = placement.dockStrip(currentDisplay().workArea, size);
    walkTo({ x: Math.min(Math.max(x, strip.minX), strip.maxX), y: strip.y });
  });

  screen.on('display-added', reclamp);
  screen.on('display-removed', reclamp);
  screen.on('display-metrics-changed', reclamp);

  /** Apply the full settings object (call on launch and after every save). */
  function applySettings(next) {
    const prev = settings;
    settings = { ...next };
    const enabled = !!settings.miniMeEnabled;
    if (enabled && !alive()) {
      unavailable = false;
      create();
    } else if (!enabled && alive()) {
      destroy();
    } else if (alive() && settings.miniMeScale !== prev.miniMeScale) {
      // Keep the feet where they are: the window grows or shrinks upwards.
      const oldHeight = size.height;
      size = placement.windowSize(settings.miniMeScale);
      const [x, y] = win.getPosition();
      stopWalking();
      win.setBounds({ x, y: y + oldHeight - size.height, ...size });
      reclamp();
    }
    if (enabled !== !!prev.miniMeEnabled || settings.miniMeHotkey !== prev.miniMeHotkey) registerHotkey();
    if (alive()) win.webContents.send('companion:settings', rendererSettings());
    notify();
    return status();
  }

  /** ⌘⇧M while Mini Me is on screen: listen in Mini Me instead of the main window. */
  function triggerListen() {
    if (!status().visible) return false;
    win.webContents.send('companion:listen');
    return true;
  }

  return {
    applySettings,
    status,
    triggerListen,
    webContentsId: () => (alive() ? win.webContents.id : null),
  };
}

module.exports = { createCompanion };
```

- [ ] **Step 2: Syntax check**

Run: `node --check electron/companion.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add electron/companion.js
git commit -m "Add the Mini Me companion window

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wire the companion into `electron/main.js` and `preload.js`

**Files:**
- Modify: `electron/main.js`, `electron/preload.js`

- [ ] **Step 1: Settings defaults**

In `electron/main.js`, add to `SETTINGS_DEFAULTS` (after `browserSearchEngine: 'brave',`):
```js
  miniMeEnabled: false,
  miniMeHotkey: 'CommandOrControl+Shift+Space',
  miniMeSpeak: true,
  miniMeScale: 3,
  miniMeWalk: true,
  miniMeSleepMinutes: 5,
  miniMeWakeWord: false,
  miniMePosition: null,
```

- [ ] **Step 2: Require the module and hold the instance**

Near the other `require('./…')` lines at the top of `electron/main.js`:
```js
const { createCompanion } = require('./companion');
```
Next to the `let tray` declaration (search `let tray`), add:
```js
let companion = null;
```

- [ ] **Step 3: Give the companion window the API token**

In `app.whenReady()`, replace:
```js
    isAppWebContents: (id) => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id === id,
```
with:
```js
    isAppWebContents: (id) =>
      (!!mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id === id) ||
      (!!companion && companion.webContentsId() === id),
```

- [ ] **Step 4: Build the tray menu in a function with a Mini Me item**

In `createTray()`, replace everything from `const menu = Menu.buildFromTemplate([` through `tray.setContextMenu(menu);` with:
```js
  tray.setContextMenu(buildTrayMenu());
```
and add above `function createTray()`:
```js
function buildTrayMenu() {
  const companionStatus = companion ? companion.status() : null;
  return Menu.buildFromTemplate([
    {
      label: 'Show Marven',
      click() { mainWindow.show(); mainWindow.focus(); },
    },
    {
      label: 'Listen  (Cmd+Shift+M)',
      click() { triggerVoice(); },
    },
    {
      label: companionStatus && companionStatus.unavailable ? 'Mini Me (unavailable)' : 'Show Mini Me',
      type: 'checkbox',
      checked: !!readStoredSettings().miniMeEnabled,
      click(item) {
        const next = persistSettings({ miniMeEnabled: item.checked });
        if (companion) companion.applySettings(next);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Marven',
      click() { isQuitting = true; app.quit(); },
    },
  ]);
}

function rebuildTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}
```

- [ ] **Step 5: Create the companion after the tray, and route ⌘⇧M**

In `app.whenReady()`, directly after `createTray();`:
```js
  companion = createCompanion({
    appPort: APP_PORT,
    saveSettings: (patch) => persistSettings(patch),
    onStatusChange: (s) => {
      rebuildTrayMenu();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('companion-visibility', { visible: s.visible, wakeWord: s.wakeWord });
      }
    },
  });
  companion.applySettings(loadSettings());
```
Replace the body of `function triggerVoice()` with:
```js
function triggerVoice() {
  if (companion && companion.triggerListen()) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('trigger-voice');
}
```

- [ ] **Step 6: Apply settings on save, and handle the companion's requests for the main window**

In the `ipcMain.handle('save-settings', …)` handler, add before `return publicSettings(next);`:
```js
  if (companion) companion.applySettings(next);
```
Below that handler add:
```js
ipcMain.handle('companion-status', () =>
  companion ? companion.status() : { visible: false, hotkeyOk: true, unavailable: false, wakeWord: false });

function fromCompanionWindow(event) {
  return !!companion && companion.webContentsId() === event.sender.id;
}

ipcMain.on('companion:open-in-marven', (event, messages) => {
  if (!fromCompanionWindow(event) || !Array.isArray(messages) || !mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('companion-open-thread', messages.slice(-20));
});

ipcMain.on('companion:open-settings', (event) => {
  if (!fromCompanionWindow(event) || !mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('companion-open-settings');
});
```

- [ ] **Step 7: Preload bridge**

In `electron/preload.js`, add above `contextBridge.exposeInMainWorld(`:
```js
// Subscribe to a main → renderer channel; returns an unsubscribe function.
const subscribe = (channel) => (cb) => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
```
Inside the exposed object, after `onUpdateStatus: …,` add:
```js
  // ── Mini Me ────────────────────────────────────────────────────────────────
  // Main window side: status, wake-word hand-over, threads and settings requests.
  companionStatus: () => ipcRenderer.invoke('companion-status'),
  onCompanionVisibility: subscribe('companion-visibility'),
  onCompanionOpenThread: subscribe('companion-open-thread'),
  onCompanionOpenSettings: subscribe('companion-open-settings'),
  // Companion window side (main ignores these from any other window).
  companion: {
    getSettings: () => ipcRenderer.invoke('companion:get-settings'),
    setInteractive: (on) => ipcRenderer.send('companion:set-interactive', !!on),
    setFocusable: (on) => ipcRenderer.send('companion:set-focusable', !!on),
    walkTo: (x) => ipcRenderer.send('companion:walk-to', x),
    stop: () => ipcRenderer.send('companion:stop'),
    drag: (dx, dy) => ipcRenderer.send('companion:drag', dx, dy),
    drop: () => ipcRenderer.send('companion:drop'),
    returnHome: () => ipcRenderer.send('companion:return-home'),
    openInMarven: (messages) => ipcRenderer.send('companion:open-in-marven', messages),
    openSettings: () => ipcRenderer.send('companion:open-settings'),
    onPosition: subscribe('companion:position'),
    onOpenInput: subscribe('companion:open-input'),
    onListen: subscribe('companion:listen'),
    onSettings: subscribe('companion:settings'),
  },
```

- [ ] **Step 8: Syntax check and existing tests**

Run: `node --check electron/main.js && node --check electron/preload.js && npx vitest run electron`
Expected: no syntax errors; all electron tests PASS.

- [ ] **Step 9: Commit**

```bash
git add electron/main.js electron/preload.js
git commit -m "Wire Mini Me into the main process, tray and preload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Typed bridge and the brain hook

**Files:**
- Create: `lib/companion/bridge.ts`, `hooks/useCompanionBrain.ts`

- [ ] **Step 1: Write `lib/companion/bridge.ts`**

```ts
// Typed access to the companion half of the preload bridge (electron/preload.js).

import type { CompanionMessage } from "./brain";
import type { Strip } from "./behaviour";

export interface CompanionPosition {
  x: number;
  y: number;
  facing: 1 | -1;
  walking: boolean;
  inDock: boolean;
  strip: Strip;
  arrived?: boolean;
}

export interface CompanionSettings {
  speak: boolean;
  scale: 2 | 3 | 4;
  walk: boolean;
  sleepMinutes: number;
  wakeWord: boolean;
}

export const DEFAULT_COMPANION_SETTINGS: CompanionSettings = {
  speak: true,
  scale: 3,
  walk: true,
  sleepMinutes: 5,
  wakeWord: false,
};

type Unsubscribe = () => void;

export interface CompanionBridge {
  getSettings(): Promise<CompanionSettings | null>;
  setInteractive(on: boolean): void;
  setFocusable(on: boolean): void;
  walkTo(x: number): void;
  stop(): void;
  drag(dx: number, dy: number): void;
  drop(): void;
  returnHome(): void;
  openInMarven(messages: CompanionMessage[]): void;
  openSettings(): void;
  onPosition(cb: (p: CompanionPosition) => void): Unsubscribe;
  onOpenInput(cb: () => void): Unsubscribe;
  onListen(cb: () => void): Unsubscribe;
  onSettings(cb: (s: CompanionSettings) => void): Unsubscribe;
}

export function getCompanionBridge(): CompanionBridge | null {
  if (typeof window === "undefined") return null;
  const electron = (window as unknown as { marvenElectron?: { companion?: CompanionBridge } }).marvenElectron;
  return electron?.companion ?? null;
}
```

- [ ] **Step 2: Write `hooks/useCompanionBrain.ts`**

```ts
"use client";

// Runs one Mini Me request end to end: timer, clipboard, Agent hand-off, or a
// /api/chat call (which also executes system commands server-side), streaming
// the reply into the bubble and optionally speaking it.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatRequest } from "@/types";
import { parseChatStream } from "@/lib/chatStream";
import { chatErrorMessage, providerErrorMessage, readChatReply } from "@/lib/chatErrors";
import { getSystemPrompt } from "@/lib/systemPrompt";
import { loadChatModelMap, loadChatProvider } from "@/lib/modelPrefs";
import { loadMemories, loadProfile } from "@/lib/userProfile";
import { buildSystemPrompt } from "@/lib/chatPrompt";
import { clipboardPrompt } from "@/lib/chatIntents";
import { speak, stopSpeaking } from "@/lib/speak";
import {
  AGENT_HANDOFF_REPLY,
  appendHistory,
  buildCompanionPrompt,
  loadHistory,
  routeInput,
  saveHistory,
  type CompanionMessage,
} from "@/lib/companion/brain";

export type BrainEvent = "thinking" | "talking" | "succeeded" | "failed";
export type BubbleAction = "retry" | "open-in-marven" | "open-settings" | null;

export interface BrainReply {
  text: string;
  action: BubbleAction;
  done: boolean;
}

interface Options {
  speakReplies: boolean;
  onEvent: (event: BrainEvent) => void;
  onSpeakingChange?: (speaking: boolean) => void;
}

async function loadGlobalMemories(): Promise<string[]> {
  try {
    const data = await (await fetch("/api/memory")).json();
    const global = data?.scopes?.global;
    return Array.isArray(global) ? global : [];
  } catch {
    return [];
  }
}

export function useCompanionBrain(options: Options) {
  const [reply, setReply] = useState<BrainReply | null>(null);
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<CompanionMessage[]>([]);
  const lastInputRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    historyRef.current = loadHistory(localStorage);
  }, []);

  const say = useCallback((text: string) => {
    const { speakReplies, onSpeakingChange } = optionsRef.current;
    if (!speakReplies || !text) return;
    onSpeakingChange?.(true);
    void speak(text, () => optionsRef.current.onSpeakingChange?.(false));
  }, []);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastInputRef.current = text;
    stopSpeaking();
    setBusy(true);

    const emit = (e: BrainEvent) => optionsRef.current.onEvent(e);
    const show = (t: string, action: BubbleAction, done: boolean) => setReply({ text: t, action, done });
    const remember = (answer: string) => {
      historyRef.current = appendHistory(
        historyRef.current,
        { role: "user", content: text },
        { role: "assistant", content: answer },
      );
      saveHistory(localStorage, historyRef.current);
    };
    const succeed = (answer: string) => {
      remember(answer);
      show(answer, null, true);
      emit("succeeded");
      say(answer);
      setBusy(false);
    };
    const fail = (message: string, action: BubbleAction) => {
      show(message, action, true);
      emit("failed");
      say(message);
      setBusy(false);
    };

    const custom = getSystemPrompt().trim();
    const route = routeInput(text, { allowCommands: !custom });

    try {
      if (route.kind === "timer") {
        setTimeout(() => {
          const done = `Timer done! (${route.label})`;
          show(done, null, true);
          emit("succeeded");
          say(done);
        }, route.ms);
        succeed(`Timer set for ${route.label}.`);
        return;
      }
      if (route.kind === "agent") {
        remember(AGENT_HANDOFF_REPLY);
        fail(AGENT_HANDOFF_REPLY, "open-in-marven");
        return;
      }

      let prompt = text;
      if (route.kind === "clipboard") {
        try {
          prompt = clipboardPrompt(route.action, await navigator.clipboard.readText());
        } catch {
          /* no clipboard access: send the request as typed */
        }
      }

      emit("thinking");
      show("", null, false);
      const provider = loadChatProvider() ?? "groq";
      const model = loadChatModelMap()?.[provider] ?? "";
      const base = buildSystemPrompt(loadProfile()?.name ?? null, {
        global: await loadGlobalMemories(),
        project: [],
        conversation: [],
        legacy: loadMemories(),
      });
      const body: ChatRequest = {
        messages: [...historyRef.current, { role: "user", content: prompt }],
        model,
        provider,
        systemPrompt: buildCompanionPrompt(base, custom),
        allowCommands: route.kind === "command",
        commandText: text,
      };
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!(res.headers.get("content-type") ?? "").includes("text/plain")) {
        // JSON: a command result, or a setup error the route caught before streaming (e.g. no API key).
        const data = await readChatReply(res);
        if (data.commandExecuted) succeed(data.reply);
        else fail(data.reply, route.kind === "command" ? null : "open-settings");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("The reply had no body.");
      const decoder = new TextDecoder();
      let rawText = "";
      let talking = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rawText += decoder.decode(value, { stream: true });
        const { text: partial } = parseChatStream(rawText);
        if (partial && !talking) {
          talking = true;
          emit("talking");
        }
        show(partial, null, false);
      }
      rawText += decoder.decode();
      const { text: full, error } = parseChatStream(rawText, true);
      if (error) {
        const why = providerErrorMessage(error);
        fail(full ? `${full}\n\n${why}` : why, "retry");
        return;
      }
      succeed(full);
    } catch (err) {
      if (controller.signal.aborted) return;
      fail(chatErrorMessage(err), "retry");
    }
  }, [say]);

  const retry = useCallback(() => send(lastInputRef.current), [send]);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    stopSpeaking();
    optionsRef.current.onSpeakingChange?.(false);
    setReply(null);
    setBusy(false);
  }, []);

  const history = useCallback(() => historyRef.current, []);

  return { reply, busy, send, retry, dismiss, history };
}
```

- [ ] **Step 3: Type check**

Run: `npm run typecheck`
Expected: exit 0. If `HistoryMessage.role` rejects the literal objects, annotate the array: `const messages: ChatRequest["messages"] = [...]`.

- [ ] **Step 4: Commit**

```bash
git add lib/companion/bridge.ts hooks/useCompanionBrain.ts
git commit -m "Add the Mini Me bridge types and request hook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The companion page

**Files:**
- Create: `app/companion/CompanionSprite.tsx`, `app/companion/SpeechBubble.tsx`, `app/companion/page.tsx`

- [ ] **Step 1: Write `app/companion/CompanionSprite.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useRef } from "react";
import { ANIMATIONS, SPRITE_SIZE, renderFrame } from "@/lib/companion/sprite";
import type { AnimState } from "@/lib/companion/behaviour";
import type { Look } from "@/lib/companion/look";

interface Props {
  look: Look;
  anim: AnimState;
  facing: 1 | -1;
  scale: number;
  onOneshotDone: () => void;
}

/** Plays Mini Me's current animation on a canvas, scaled up with crisp pixels. */
export function CompanionSprite({ look, anim, facing, scale, onOneshotDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onOneshotDone);
  doneRef.current = onOneshotDone;

  // Rendered frames, per animation, for the current look.
  const framesFor = useMemo(() => {
    const cache = new Map<AnimState, HTMLCanvasElement[]>();
    return (state: AnimState) => {
      let list = cache.get(state);
      if (!list) {
        list = ANIMATIONS[state].frames.map((spec) => {
          const c = document.createElement("canvas");
          c.width = SPRITE_SIZE;
          c.height = SPRITE_SIZE;
          const ctx = c.getContext("2d");
          if (ctx) {
            renderFrame(look, spec).forEach((color, i) => {
              if (!color) return;
              ctx.fillStyle = color;
              ctx.fillRect(i % SPRITE_SIZE, Math.floor(i / SPRITE_SIZE), 1, 1);
            });
          }
          return c;
        });
        cache.set(state, list);
      }
      return list;
    };
  }, [look]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const animation = ANIMATIONS[anim];
    const frames = framesFor(anim);
    let i = 0;
    const draw = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      if (facing < 0) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(frames[i], 0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
    draw();
    const timer = setInterval(() => {
      if (i === frames.length - 1 && !animation.loop) {
        clearInterval(timer);
        doneRef.current();
        return;
      }
      i = (i + 1) % frames.length;
      draw();
    }, 1000 / animation.fps);
    return () => clearInterval(timer);
  }, [anim, facing, framesFor]);

  const px = SPRITE_SIZE * scale;
  return (
    <canvas
      ref={canvasRef}
      width={px}
      height={px}
      style={{ width: px, height: px, imageRendering: "pixelated" }}
      aria-label="Mini Me"
    />
  );
}
```

- [ ] **Step 2: Write `app/companion/SpeechBubble.tsx`**

```tsx
"use client";

import type { RefObject } from "react";
import type { BrainReply, BubbleAction } from "@/hooks/useCompanionBrain";

interface Props {
  reply: BrainReply | null;
  busy: boolean;
  listening: boolean;
  /** A voice problem (e.g. mic permission denied); typing still works. */
  notice: string | null;
  draft: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onDraftChange: (text: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  onAction: (action: Exclude<BubbleAction, null>) => void;
}

const ACTION_LABELS: Record<Exclude<BubbleAction, null>, string> = {
  retry: "Retry",
  "open-in-marven": "Open in Marven",
  "open-settings": "Open settings",
};

export function SpeechBubble({ reply, busy, listening, notice, draft, inputRef, onDraftChange, onSubmit, onClose, onAction }: Props) {
  const text = reply?.text || (busy ? "…" : "");
  return (
    <div
      data-hit
      className="relative w-[320px] rounded-xl border border-[var(--m-border)] bg-[var(--m-surface)] p-3 text-[13px] text-[var(--m-text)] shadow-lg"
    >
      {text && (
        <p className="mb-2 max-h-[84px] overflow-y-auto whitespace-pre-wrap leading-snug">{text}</p>
      )}
      {reply?.done && reply.action && (
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            onClick={() => onAction(reply.action as Exclude<BubbleAction, null>)}
            className="rounded-md bg-[var(--m-accent)] px-2 py-1 text-[12px] font-medium text-white"
          >
            {ACTION_LABELS[reply.action]}
          </button>
          {reply.action === "open-in-marven" && (
            <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-[12px] text-[var(--m-text-faint)]">
              Not now
            </button>
          )}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          placeholder={listening ? "Listening…" : "Tell me what to do…"}
          className="w-full rounded-md border border-[var(--m-border-subtle)] bg-transparent px-2 py-1.5 outline-none focus:border-[var(--m-accent)]"
          aria-label="Message Mini Me"
        />
      </form>
      {notice && (
        <p className="mt-1.5 text-[11px] text-[var(--m-text-faint)]">
          Voice isn&apos;t available ({notice}). Allow microphone access for Marven in System Settings → Privacy &amp; Security, or just type.
        </p>
      )}
      {/* tail pointing down at the character */}
      <div className="absolute -bottom-[7px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-[var(--m-border)] bg-[var(--m-surface)]" />
    </div>
  );
}
```

- [ ] **Step 3: Write `app/companion/page.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompanionSprite } from "./CompanionSprite";
import { SpeechBubble } from "./SpeechBubble";
import { useCompanionBrain, type BrainEvent, type BubbleAction } from "@/hooks/useCompanionBrain";
import { useVoice } from "@/hooks/useVoice";
import { stopSpeaking } from "@/lib/speak";
import { initialState, reduce, type BehaviourEvent, type BehaviourState, type Strip } from "@/lib/companion/behaviour";
import { DEFAULT_LOOK, parseLook, type Look } from "@/lib/companion/look";
import { DEFAULT_COMPANION_SETTINGS, getCompanionBridge, type CompanionSettings } from "@/lib/companion/bridge";

const AUTO_CLOSE_MS = 8000;

export default function CompanionPage() {
  const bridge = useMemo(getCompanionBridge, []);
  const [settings, setSettings] = useState<CompanionSettings>(DEFAULT_COMPANION_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const behaviourRef = useRef<BehaviourState>(initialState(Date.now()));
  const [behaviour, setBehaviour] = useState<BehaviourState>(behaviourRef.current);
  const [facing, setFacing] = useState<1 | -1>(1);
  const stripRef = useRef<Strip>({ minX: 0, maxX: 0 });
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const interactiveRef = useRef(false);
  const hoveredRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pendingDropRef = useRef(false);

  const dispatch = useCallback(
    (event: BehaviourEvent) => {
      const { state, effect } = reduce(behaviourRef.current, event);
      behaviourRef.current = state;
      setBehaviour(state);
      if (effect.stop) bridge?.stop();
      if (effect.walkTo !== undefined) bridge?.walkTo(effect.walkTo);
      if (effect.returnHome) bridge?.returnHome();
    },
    [bridge],
  );

  const setInteractive = useCallback(
    (on: boolean) => {
      if (on === interactiveRef.current) return;
      interactiveRef.current = on;
      bridge?.setInteractive(on);
    },
    [bridge],
  );

  // ── Brain and voice ────────────────────────────────────────────────────────
  const voiceRef = useRef<{ pause: () => void; resume: () => void }>({ pause: () => {}, resume: () => {} });
  // Destructured so the callbacks below depend on the hook's stable functions,
  // not on the object it returns (which is new every render).
  const { reply, busy, send, retry, dismiss, history } = useCompanionBrain({
    speakReplies: settings.speak,
    onEvent: (e: BrainEvent) => dispatch({ type: e, now: Date.now() }),
    onSpeakingChange: (speaking) => (speaking ? voiceRef.current.pause() : voiceRef.current.resume()),
  });

  const openBubble = useCallback(
    (focus: boolean) => {
      setBubbleOpen(true);
      dispatch({ type: "interact", now: Date.now() });
      dispatch({ type: "bubble-open", now: Date.now() });
      setInteractive(true);
      if (focus) {
        bridge?.setFocusable(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [bridge, dispatch, setInteractive],
  );

  const closeBubble = useCallback(() => {
    setBubbleOpen(false);
    setDraft("");
    dismiss();
    bridge?.setFocusable(false);
    dispatch({ type: "bubble-close", now: Date.now() });
  }, [dismiss, bridge, dispatch]);

  const {
    voiceState,
    voiceError,
    wakeEnabled,
    toggleWakeWord,
    startManualListen,
    pauseVoiceCapture,
    resumeWakeWord,
  } = useVoice(
    (text) => {
      openBubble(false);
      setDraft("");
      void send(text);
    },
    () => {
      stopSpeaking();
      openBubble(false);
    },
    (interim) => setDraft(interim),
  );
  voiceRef.current = { pause: pauseVoiceCapture, resume: resumeWakeWord };
  // useVoice recreates startManualListen every render; keep the latest in a ref
  // so the IPC subscriptions below aren't torn down and rebuilt each render.
  const startListenRef = useRef(startManualListen);
  startListenRef.current = startManualListen;

  // "Listen for Hey Marven" setting drives this window's wake listener.
  useEffect(() => {
    if (settings.wakeWord !== wakeEnabled) toggleWakeWord();
    // toggleWakeWord is recreated every render; only the two flags matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.wakeWord, wakeEnabled]);

  // ── Wiring to the main process ─────────────────────────────────────────────
  useEffect(() => {
    if (!bridge) return;
    void bridge.getSettings().then((s) => s && setSettings(s));
    const offs = [
      bridge.onSettings(setSettings),
      bridge.onPosition((p) => {
        stripRef.current = p.strip;
        setFacing(p.facing);
        if (p.arrived) dispatch({ type: "arrived", now: Date.now() });
        if (pendingDropRef.current) {
          pendingDropRef.current = false;
          dispatch({ type: "drop", now: Date.now(), inDock: p.inDock });
        }
      }),
      bridge.onOpenInput(() => openBubble(true)),
      bridge.onListen(() => {
        openBubble(false);
        startListenRef.current();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [bridge, dispatch, openBubble]);

  useEffect(() => {
    fetch("/companion/look.json")
      .then((r) => r.json())
      .then((j) => setLook(parseLook(j)))
      .catch(() => {});
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  // Idle clock
  useEffect(() => {
    const timer = setInterval(() => {
      const s = settingsRef.current;
      dispatch({
        type: "tick",
        now: Date.now(),
        rand: Math.random,
        strip: stripRef.current,
        walkAround: s.walk,
        sleepAfterMs: s.sleepMinutes * 60_000,
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [dispatch]);

  // Click-through: take the mouse only over the character or the bubble.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const hit = !!(e.target as Element | null)?.closest?.("[data-hit]");
      setInteractive(hit || !!dragRef.current);
      if (hit !== hoveredRef.current) {
        hoveredRef.current = hit;
        setHovered(hit);
        if (hit) dispatch({ type: "interact", now: Date.now() });
      }
    };
    const onLeave = () => {
      if (!dragRef.current) setInteractive(false);
      hoveredRef.current = false;
      setHovered(false);
    };
    document.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [dispatch, setInteractive]);

  // Fade the bubble after a finished reply unless the user is engaged with it.
  useEffect(() => {
    if (!bubbleOpen || !reply?.done || hovered || draft) return;
    const timer = setTimeout(closeBubble, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [bubbleOpen, reply, hovered, draft, closeBubble]);

  const onAction = (action: Exclude<BubbleAction, null>) => {
    if (action === "retry") void retry();
    else if (action === "open-in-marven") {
      bridge?.openInMarven(history());
      closeBubble();
    } else {
      bridge?.openSettings();
      closeBubble();
    }
  };

  return (
    <main className="flex h-screen w-screen select-none flex-col items-center justify-end overflow-hidden">
      <style>{`html,body{background:transparent!important;overflow:hidden}`}</style>
      {bubbleOpen && (
        <div className="mb-3">
          <SpeechBubble
            reply={reply}
            busy={busy}
            listening={voiceState === "command-listening"}
            notice={voiceError}
            draft={draft}
            inputRef={inputRef}
            onDraftChange={setDraft}
            onSubmit={() => {
              const text = draft;
              setDraft("");
              void send(text);
            }}
            onClose={closeBubble}
            onAction={onAction}
          />
        </div>
      )}
      <div
        data-hit
        className="cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { x: e.screenX, y: e.screenY, moved: false };
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          const dx = e.screenX - d.x;
          const dy = e.screenY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          if (!d.moved) {
            d.moved = true;
            dispatch({ type: "drag-start", now: Date.now() });
          }
          d.x = e.screenX;
          d.y = e.screenY;
          bridge?.drag(dx, dy);
        }}
        onPointerUp={() => {
          const d = dragRef.current;
          dragRef.current = null;
          if (d?.moved) {
            pendingDropRef.current = true;
            bridge?.drop();
          } else if (bubbleOpen) {
            closeBubble();
          } else {
            openBubble(true);
          }
        }}
        onDoubleClick={() => {
          if (bubbleOpen) closeBubble();
          dispatch({ type: "return-home", now: Date.now() });
        }}
      >
        <CompanionSprite
          look={look}
          anim={behaviour.anim}
          facing={facing}
          scale={settings.scale}
          onOneshotDone={() => dispatch({ type: "oneshot-done", now: Date.now() })}
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Type check and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0; the build output lists the `/companion` route.

- [ ] **Step 5: Commit**

```bash
git add app/companion
git commit -m "Add the Mini Me companion page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Main window hand-overs (wake word, Open in Marven, Open settings)

**Files:**
- Modify: `app/page.tsx` (next to the "Electron global shortcut → trigger voice" effect, ≈ line 1600)

- [ ] **Step 1: Add the effects**

Add `import { openSettingsPage } from "@/lib/settingsNav";` with the other imports, then insert after the `// ── Electron global shortcut → trigger voice` effect:
```tsx
  // ── Mini Me ────────────────────────────────────────────────────────────────
  // While Mini Me is on screen and listening for "Hey Marven", the main
  // window's wake listener stands down so the mic isn't used twice. It comes
  // back when Mini Me goes away.
  const wakeEnabledNowRef = useRef(wakeEnabled);
  wakeEnabledNowRef.current = wakeEnabled;
  const toggleWakeWordRef = useRef(toggleWakeWord);
  toggleWakeWordRef.current = toggleWakeWord;
  const restoreWakeRef = useRef(false);
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = (window as any).marvenElectron;
    if (!electron?.onCompanionVisibility) return;
    return electron.onCompanionVisibility(({ visible, wakeWord }: { visible: boolean; wakeWord: boolean }) => {
      const companionListens = visible && wakeWord;
      if (companionListens && wakeEnabledNowRef.current) {
        restoreWakeRef.current = true;
        toggleWakeWordRef.current();
      } else if (!companionListens && restoreWakeRef.current) {
        restoreWakeRef.current = false;
        if (!wakeEnabledNowRef.current) toggleWakeWordRef.current();
      }
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = (window as any).marvenElectron;
    if (!electron?.onCompanionOpenThread) return;
    const offThread = electron.onCompanionOpenThread((raw: unknown) => {
      if (!Array.isArray(raw)) return;
      const messages = raw.filter(
        (m): m is { role: "user" | "assistant"; content: string } =>
          !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
      );
      if (messages.length === 0) return;
      const firstUser = messages.find((m) => m.role === "user")?.content ?? "Mini Me";
      const conv: Conversation = {
        ...createConversation(firstUser),
        messages: messages.map((m) => createMessage(m.role, m.content)),
      };
      setConversations((prev) => [...prev, conv]);
      setActiveConversationId(conv.id);
    });
    const offSettings = electron.onCompanionOpenSettings(() => openSettingsPage({ page: "general" }));
    return () => {
      offThread?.();
      offSettings?.();
    };
  }, []);
```

- [ ] **Step 2: Type check**

Run: `npm run typecheck`
Expected: exit 0. If `Conversation.messages` is not `Message[]`, check `types/index.ts` and adapt the `map` to the declared element type.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "Let the main window hand voice and threads to and from Mini Me

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Mini Me settings card

**Files:**
- Create: `app/components/marven/MiniMeSettings.tsx`
- Modify: `app/components/marven/SettingsModal.tsx`, `lib/i18n/settings.en.ts`, `lib/i18n/settings.ar.ts`

- [ ] **Step 1: Add the strings**

In `lib/i18n/settings.en.ts`, inside the `general: {` block (after `agentBrowsingHint`'s value), add:
```ts
    miniMe: "Mini Me",
    miniMeHint: "A tiny you that lives on your desktop and does what you tell it.",
    miniMeShow: "Show Mini Me",
    miniMeWake: "Listen for \"Hey Marven\"",
    miniMeWakeHint: "Mini Me takes over the wake word while it's on screen.",
    miniMeSpeak: "Speak replies",
    miniMeWalk: "Walk around",
    miniMeSize: "Size",
    miniMeSleep: "Fall asleep after",
    miniMeMinutes: "minutes",
    miniMeHotkey: "Shortcut",
    miniMeHotkeyHint: "Opens Mini Me's bubble from anywhere, e.g. CommandOrControl+Shift+Space.",
    miniMeHotkeyUnavailable: "Shortcut unavailable: another app is using it.",
```
In `lib/i18n/settings.ar.ts`, in the same place:
```ts
    miniMe: "ميني مي",
    miniMeHint: "نسخة صغيرة منك تعيش على سطح المكتب وتنفّذ ما تطلبه.",
    miniMeShow: "إظهار ميني مي",
    miniMeWake: "الاستماع إلى \"Hey Marven\"",
    miniMeWakeHint: "يتولى ميني مي كلمة التنبيه ما دام ظاهرًا على الشاشة.",
    miniMeSpeak: "قراءة الردود بصوت عالٍ",
    miniMeWalk: "التجول",
    miniMeSize: "الحجم",
    miniMeSleep: "النوم بعد",
    miniMeMinutes: "دقائق",
    miniMeHotkey: "الاختصار",
    miniMeHotkeyHint: "يفتح فقاعة ميني مي من أي مكان، مثل CommandOrControl+Shift+Space.",
    miniMeHotkeyUnavailable: "الاختصار غير متاح: يستخدمه تطبيق آخر.",
```

- [ ] **Step 2: Write `app/components/marven/MiniMeSettings.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Electron = {
  getSettings: () => Promise<any>;
  saveSettings: (s: any) => Promise<any>;
  companionStatus?: () => Promise<{ hotkeyOk: boolean }>;
};

interface MiniMeState {
  miniMeEnabled: boolean;
  miniMeWakeWord: boolean;
  miniMeSpeak: boolean;
  miniMeWalk: boolean;
  miniMeScale: number;
  miniMeSleepMinutes: number;
  miniMeHotkey: string;
}

const DEFAULTS: MiniMeState = {
  miniMeEnabled: false,
  miniMeWakeWord: false,
  miniMeSpeak: true,
  miniMeWalk: true,
  miniMeScale: 3,
  miniMeSleepMinutes: 5,
  miniMeHotkey: "CommandOrControl+Shift+Space",
};

function Switch({ id, checked, onChange }: { id: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-labelledby={id}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-[var(--m-accent)]" : "bg-[var(--m-border)]"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-5 rtl:-translate-x-5" : "translate-x-1 rtl:-translate-x-1"
        }`}
      />
    </button>
  );
}

/** Settings → General → Mini Me (desktop app only). */
export function MiniMeSettings({ electron }: { electron: Electron }) {
  const { t: tr } = useT();
  const [state, setState] = useState<MiniMeState>(DEFAULTS);
  const [hotkeyDraft, setHotkeyDraft] = useState(DEFAULTS.miniMeHotkey);
  const [hotkeyOk, setHotkeyOk] = useState(true);

  useEffect(() => {
    void electron.getSettings().then((s: any) => {
      const next = { ...DEFAULTS };
      for (const key of Object.keys(DEFAULTS) as (keyof MiniMeState)[]) {
        if (typeof s?.[key] === typeof DEFAULTS[key]) (next as any)[key] = s[key];
      }
      setState(next);
      setHotkeyDraft(next.miniMeHotkey);
    });
    void electron.companionStatus?.().then((st) => setHotkeyOk(st.hotkeyOk));
  }, [electron]);

  async function save(patch: Partial<MiniMeState>) {
    setState((prev) => ({ ...prev, ...patch }));
    const current = await electron.getSettings();
    await electron.saveSettings({ ...current, ...patch });
    const st = await electron.companionStatus?.();
    if (st) setHotkeyOk(st.hotkeyOk);
  }

  const row = (id: string, label: string, checked: boolean, key: keyof MiniMeState, hint?: string) => (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h4 id={id} className="text-[12px] text-[var(--m-text)]">{label}</h4>
        {hint && <p className="mt-0.5 text-[11px] text-[var(--m-text-faint)]">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onChange={(next) => void save({ [key]: next } as Partial<MiniMeState>)} />
    </div>
  );

  return (
    <div className="rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-surface)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="mini-me-label" className="text-[13px] font-medium text-[var(--m-text)]">{tr("settings.general.miniMe")}</h3>
          <p className="mt-0.5 text-[11px] text-[var(--m-text-faint)]">{tr("settings.general.miniMeHint")}</p>
        </div>
        <Switch id="mini-me-label" checked={state.miniMeEnabled} onChange={(next) => void save({ miniMeEnabled: next })} />
      </div>

      {state.miniMeEnabled && (
        <div className="mt-4 space-y-3 border-t border-[var(--m-border-subtle)] pt-3">
          {row("mini-me-wake", tr("settings.general.miniMeWake"), state.miniMeWakeWord, "miniMeWakeWord", tr("settings.general.miniMeWakeHint"))}
          {row("mini-me-speak", tr("settings.general.miniMeSpeak"), state.miniMeSpeak, "miniMeSpeak")}
          {row("mini-me-walk", tr("settings.general.miniMeWalk"), state.miniMeWalk, "miniMeWalk")}

          <div className="flex items-center justify-between gap-4">
            <label htmlFor="mini-me-size" className="text-[12px] text-[var(--m-text)]">{tr("settings.general.miniMeSize")}</label>
            <select
              id="mini-me-size"
              value={state.miniMeScale}
              onChange={(e) => void save({ miniMeScale: Number(e.target.value) })}
              className="rounded-md border border-[var(--m-border)] bg-transparent px-2 py-1 text-[12px]"
            >
              {[2, 3, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <label htmlFor="mini-me-sleep" className="text-[12px] text-[var(--m-text)]">{tr("settings.general.miniMeSleep")}</label>
            <select
              id="mini-me-sleep"
              value={state.miniMeSleepMinutes}
              onChange={(e) => void save({ miniMeSleepMinutes: Number(e.target.value) })}
              className="rounded-md border border-[var(--m-border)] bg-transparent px-2 py-1 text-[12px]"
            >
              {[1, 5, 10, 30].map((m) => (
                <option key={m} value={m}>{m} {tr("settings.general.miniMeMinutes")}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="mini-me-hotkey" className="text-[12px] text-[var(--m-text)]">{tr("settings.general.miniMeHotkey")}</label>
            <input
              id="mini-me-hotkey"
              value={hotkeyDraft}
              onChange={(e) => setHotkeyDraft(e.target.value)}
              onBlur={() => {
                if (hotkeyDraft.trim() !== state.miniMeHotkey) void save({ miniMeHotkey: hotkeyDraft.trim() });
              }}
              className="mt-1 w-full rounded-md border border-[var(--m-border)] bg-transparent px-2 py-1 font-mono text-[12px]"
            />
            <p className={`mt-1 text-[11px] ${hotkeyOk ? "text-[var(--m-text-faint)]" : "text-red-400"}`}>
              {hotkeyOk ? tr("settings.general.miniMeHotkeyHint") : tr("settings.general.miniMeHotkeyUnavailable")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
```

Before saving, run `grep -n "export function useT\|export const useT" -r lib/i18n` and adjust the import path if `useT` is exported from a different module than `@/lib/i18n` (use the same import `SettingsModal.tsx` uses).

- [ ] **Step 3: Render the card**

In `app/components/marven/SettingsModal.tsx`, add the import `import { MiniMeSettings } from "./MiniMeSettings";` and insert directly above the `{/* Let the agent use the browser toggle (desktop app only) */}` comment:
```tsx
            {electron && <MiniMeSettings electron={electron} />}
```

- [ ] **Step 4: Tests and type check**

Run: `npx vitest run lib/i18n && npm run typecheck`
Expected: i18n tests PASS (Arabic has every new key); typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add app/components/marven/MiniMeSettings.tsx app/components/marven/SettingsModal.tsx lib/i18n/settings.en.ts lib/i18n/settings.ar.ts
git commit -m "Add Mini Me settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Run it and check it by hand

**Files:** none (fix anything found in the file it belongs to, then re-run this task)

- [ ] **Step 1: Full test suite and build**

Run: `npm test && npm run build`
Expected: all tests PASS; build exits 0.

- [ ] **Step 2: Launch**

Run (in the background): `npm run electron:dev`
Then Settings → General → turn on **Mini Me**.

- [ ] **Step 3: Check each behaviour and note the result**

| Check | Expected |
|---|---|
| Character appears | Bottom-right, feet just above the Dock, no window shadow or background |
| Click-through | Clicking empty space around the character reaches the app underneath |
| Idle | Within a minute it walks, looks around, sits |
| Drag | It dangles while dragged; dropped mid-screen it sits and stays; dropped near the bottom it walks again |
| Double-click | Walks back down to the Dock |
| Click → "open Calculator" | Calculator opens, bubble confirms, happy hop |
| Click → "tell me a joke" | Thinks, then talks while the reply streams in |
| ⌘⇧Space | Bubble opens with the cursor in the input; main window does not jump forward |
| Esc | Bubble closes |
| "run npm install" | Shrug and "Open in Marven"; the button opens the thread in the main window |
| No API key for the selected provider | Shrug, the error and "Open settings" |
| Turn on "Listen for Hey Marven", say it | Bubble opens in listen pose; reply is spoken |
| Close the main window | Mini Me keeps working |
| Tray → Show Mini Me | Toggles it on and off |
| Size 4× | Character grows upwards, feet stay put |

- [ ] **Step 4: Stop the app and commit any fixes**

```bash
git add -A apps/desktop
git commit -m "Fix issues found trying Mini Me by hand

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Skip the commit if nothing changed.)

---

### Task 13: Your look, docs and spec

**Files:**
- Modify: `public/companion/look.json`, `README.md` (repo root), `HANDOFF.md` (repo root), `docs/superpowers/specs/2026-11-23-mini-me-companion-design.md`

- [ ] **Step 1: Set the user's look**

Fill `public/companion/look.json` from the user's description or photo: skin, hair colour, `hairStyle` (`short`/`long`/`curly`/`buzz`/`bald`), glasses and their colour, beard, usual shirt/pants/shoes colours. Relaunch and confirm it reads as them; adjust colours until it does.

- [ ] **Step 2: Docs**

In the root `README.md`, under `### System`, add:
```markdown
- **Mini Me** — a pixel-art companion that walks along the bottom of your screen. Click it (or press ⌘⇧Space) and tell it what to do: it answers, opens apps and sites, sets timers and reads replies aloud, using your chat model. Shell and file jobs go to the Agent. Turn it on in **Settings → General → Mini Me**; change its look in `apps/desktop/public/companion/look.json`.
```
In `HANDOFF.md`, add rows to the Key Files table:
```markdown
| `electron/companion.js` | Mini Me window: lifecycle, walking, drag, hotkey, IPC |
| `app/companion/page.tsx` | Mini Me page: behaviour, bubble, voice |
| `lib/companion/` | Mini Me state machine, routing, look and sprite renderer |
```

- [ ] **Step 3: Bring the spec in line with what was built**

In the spec, update these rows/sections:
- **Auth** row: "The companion window is added to `isAppWebContents` in `electron/main.js`, so the existing `x-marven-token` stamping covers its requests."
- **Wake word ownership** row: "A Mini Me setting, 'Listen for Hey Marven' (default off). While Mini Me is shown with it on, the main window's listener stands down and comes back afterwards. ⌘⇧M listens in Mini Me while it is on screen."
- **Sprite assets** section: replace the PNG sheet with "`public/companion/look.json` (colours and features); frames are drawn procedurally by `lib/companion/sprite.ts`."
- **Settings** table: add "Listen for 'Hey Marven' | Off".
- **Error handling**, "Display removed or resized": "Re-clamp onto the nearest visible display."
- **Window** section: note `type: 'panel'` on macOS so focusing the bubble doesn't activate Marven's main window.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/public/companion/look.json README.md HANDOFF.md docs/superpowers/specs/2026-11-23-mini-me-companion-design.md
git commit -m "Give Mini Me its look and document it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
