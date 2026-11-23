# Mini Me Companion — Design Spec
_2026-11-23_

## Overview

A small pixel-art "mini you" that lives on the desktop, walks along the bottom of the screen, and does what you tell it. It is a face for the brain Marven already has: the natural-language command pipeline (`lib/commandParser.ts` → `lib/executeCommand.ts` → `/api/system`), chat (`/api/chat` with the user's chosen provider), voice (`hooks/useVoice.ts`, "Hey Marven") and speech output (`/api/tts`).

It is a second, transparent, always-on-top Electron window inside Marven, not a separate app. It runs whenever Marven runs, including when the main window is closed (Marven stays in the tray).

---

## Design Decisions

| Decision | Choice |
|---|---|
| Where it lives | Inside Marven: a second `BrowserWindow` created by the main process, loading the Next.js route `/companion` |
| Look | Pixel-art likeness of the user, 32×32 frames drawn at 2×/3×/4× (default 3×), from a description or photo the user provides |
| Input | Click the character or press the global hotkey (default ⌘⇧Space) to open a text bubble; "Hey Marven" voice via the existing `useVoice` |
| Idle life | Walks along the bottom of the screen it is on, looks around, sits, stretches; sleeps after 5 minutes without interaction |
| Window shape | A small box (~360×280 at 3×) sized to character + bubble, moved by the main process; not a full-width strip |
| Click-through | Transparent parts ignore the mouse (`setIgnoreMouseEvents(true, { forward: true })`); the window takes the mouse only while the pointer is over the sprite or bubble |
| Abilities (v1) | Everything chat mode can do: answer, open apps/sites, search, timers, volume, media, screenshots, clipboard, memory |
| Not allowed (v1) | Shell commands, file edits, agent browsing. Such requests get a reply offering to open Marven's Agent, where the existing approval prompts apply |
| Conversation | Own rolling history, last 20 messages, saved in localStorage; "Open in Marven" moves the thread to a new chat in the main window |
| Wake word ownership | Only one window listens. While Mini Me is shown, the companion owns "Hey Marven" and the main window's listener stands down |
| Default | Off. Turned on from Settings or the tray |
| Auth | None new: the companion window uses the main window's session, so the existing `x-marven-token` stamping (`electron/apiToken.js`) covers its requests |

---

## Architecture

### Main process

**`electron/companion.js`** (new) owns the companion window:

- Creates it with `frame: false`, `transparent: true`, `hasShadow: false`, `resizable: false`, `skipTaskbar: true`, `focusable` toggled on only while the input bubble is open, `alwaysOnTop` at level `'floating'`, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })`.
- Uses the same `session` as the main window and the same preload bridge (with the companion IPC channels below).
- Loads `http://localhost:<APP_PORT>/companion` with the main window's capped retry pattern (20 attempts, 1.5 s apart). If it gives up, it hides the window and the tray item reads "Mini Me (unavailable)".
- Moves the window. Walking is a main-process timer (~30 fps) that steps `setPosition` toward a target the renderer requested; dragging is driven by renderer pointer deltas.
- Listens to `screen` `display-added` / `display-removed` / `display-metrics-changed` and re-clamps the window onto a visible display.
- Saves the last position and display id to the settings file on move end; restores it on launch, clamped.
- Registers and unregisters the hotkey with `globalShortcut` when the setting changes; the hotkey shows Mini Me if hidden and opens the input bubble.

**`electron/companionPlacement.js`** (new, no Electron imports, unit-tested): pure helpers

- `dockStrip(display)`: the band along the bottom of `display.workArea` where the character walks (the bottom edge of the work area sits above the Dock).
- `clampToDisplays(rect, displays)`: moves a rect fully onto the nearest display.
- `isInDockStrip(rect, display)`: decides whether a dropped character resumes walking or sits where it was dropped.
- `restorePosition(saved, displays)`: saved position if its display still exists and the rect fits, else the default (bottom-right of the primary display's dock strip).

**`electron/main.js`** changes: require `companion.js`; add a "Show Mini Me" checkbox item to the tray menu; create the window on launch when the setting is on; route `companion:open-in-marven` and `companion:open-settings` to the main window (showing it if hidden).

**`electron/preload.js`** additions (exposed under `window.marven.companion`):

| Channel | Direction | Purpose |
|---|---|---|
| `companion:set-interactive(bool)` | renderer → main | Pointer entered/left sprite or bubble: toggles `setIgnoreMouseEvents` |
| `companion:set-focusable(bool)` | renderer → main | Bubble input opened/closed |
| `companion:walk-to(x)` | renderer → main | Start walking toward x within the dock strip |
| `companion:stop` | renderer → main | Stop walking |
| `companion:drag(dx, dy)` / `companion:drop` | renderer → main | Move during drag; drop decides walk vs sit |
| `companion:return-home` | renderer → main | Double-click: back to dock strip |
| `companion:position` | main → renderer | Current position, facing, whether in dock strip, arrived/edge events |
| `companion:open-input` | main → renderer | Hotkey pressed |
| `companion:open-in-marven(messages)` | renderer → main | Hand thread to main window |
| `companion:open-settings` | renderer → main | Open Settings in main window |

### Renderer (`app/companion/`)

- **`page.tsx`**: transparent page (`background: transparent`, no app chrome), composes the pieces below.
- **`CompanionSprite.tsx`**: draws the current frame on a `<canvas>` with `imageSmoothingEnabled = false`, flips horizontally for facing, reports pointer enter/leave, click, double-click and drag.
- **`SpeechBubble.tsx`**: reply text (max ~4 lines, scrolls beyond), input box, Retry / "Open in Marven" / "Open settings" buttons when relevant. Fades 8 s after a reply finishes unless hovered; Esc closes.
- **`lib/companion/behaviour.ts`**: pure state machine (see below), unit-tested with fake timers.
- **`lib/companion/brain.ts`**: routing and prompt building (see Data flow), unit-tested.
- **`hooks/useCompanionBrain.ts`**: glue: runs `brain.ts` decisions against `executeCommand`, `/api/chat` streaming (`parseChatStream`), and `/api/tts`; feeds events to the behaviour machine.
- Voice: `useVoice` with the user's existing STT settings; wake → `listen` state.

### Sprite assets

- `public/companion/mini-me.png`: sprite sheet, 32×32 frames, transparent background.
- `public/companion/mini-me.json`: frame map `{ "<state>": { "frames": [[col,row], ...], "fps": n, "loop": bool } }`. Swapping art means replacing these two files, no code change.
- States and minimum frames: `idle` (4, blink/breathe), `walk` (6), `look` (4), `sit` (2), `stretch` (6, once), `sleep` (4, with Zzz), `listen` (4), `think` (4), `talk` (4), `happy` (6, once), `confused` (6, once), `dangle` (4).
- The likeness (hair, skin tone, glasses, usual outfit/colours) comes from the user's description or photo at implementation time.

---

## Behaviour

State machine in `lib/companion/behaviour.ts`. Inputs are events; output is the current animation state plus movement intents.

**Idle loop** (only when "Walk around" is on and the character is in the dock strip): every 4–10 s pick a weighted action: walk to a random x in the strip (40%), stand/`idle` (25%), `look` (15%), `sit` (15%), `stretch` (5%). With "Walk around" off, it alternates `idle` / `sit` / `look` in place.

**Sleep:** after the configured idle time (default 5 min) with no interaction → `sleep`. Hover, click, hotkey or wake word → wake (`stretch`, then `idle`).

**Drag:** pointer-down + move > 4 px → `dangle`, window follows the pointer. On drop: in the dock strip → resume idle loop; elsewhere → `sit` and stay put (no walking). Double-click → `return-home`, walks back to the dock strip.

**Command cycle** (overrides idle/sleep; idle loop pauses until the bubble closes):

| Event | State |
|---|---|
| Bubble opened / wake word heard | `listen` |
| Request sent to chat | `think` |
| First reply tokens / TTS playing | `talk` |
| System command succeeded | `happy` → `idle` |
| Command failed / provider error / no provider | `confused` → `idle` |

---

## Data flow

1. Input arrives (typed in the bubble, or transcribed by `useVoice`).
2. `brain.route(text)`:
   - `parseCommand(text)` returns a command → `executeCommand(...)` runs it; bubble shows the confirmation line. No chat call.
   - Text matches the agent-only intents (run/execute a command, edit/create/delete a file, "browse to … and …") → reply "That's an Agent job. Open it in Marven?" with an "Open in Marven" button. Nothing runs.
   - Otherwise → chat.
3. Chat: `POST /api/chat` with the user's current chat-mode provider and model (the same settings the main chat uses, including the failover chain), the companion history (last 20 messages), and the system prompt: Marven's base prompt plus the persona line "You are Mini Me, a tiny version of the user living on their screen. Keep replies to 1–3 short sentences." Memory entries are included the same way the main chat includes them.
4. Stream into the bubble via `parseChatStream`; when complete, append both messages to history (trim to 20) and, if "Speak replies" is on, send the reply to `/api/tts`.
5. "Open in Marven": sends the history to the main window, which creates a new conversation from it and focuses it.

---

## Settings

New "Mini Me" group in Settings → General, stored with the other settings:

| Setting | Default |
|---|---|
| Show Mini Me | Off |
| Hotkey | ⌘⇧Space |
| Speak replies | On |
| Size | 3× |
| Walk around | On |
| Sleep after | 5 minutes |

The tray "Show Mini Me" checkbox and this setting are the same value.

---

## Error Handling

| Situation | Behaviour |
|---|---|
| No provider / API key configured | `confused`; bubble: "I need a brain first" + "Open settings" |
| Provider error, timeout, rate limit | `describeProviderError` text in the bubble, `confused`, Retry button; failover chain applies first if configured |
| System command fails | `confused`; one-line reason from `executeCommand`; no fallback to chat |
| Mic permission denied / STT unavailable | Typing still works; one-time hint in the bubble on how to enable the mic |
| Display removed or resized | Re-clamp onto a visible display; if it was walking, continue in the new dock strip |
| Hotkey already taken | Setting shows "Shortcut unavailable"; Mini Me still works by clicking |
| Companion page fails to load | Capped retries, then hide window; tray shows "Mini Me (unavailable)" |

---

## Testing

Vitest, following the repo's `*.test.ts` pattern:

- `lib/companion/behaviour.test.ts`: idle-loop transitions, sleep timeout and wake, drag → drop in/out of dock strip, double-click return, command-cycle states, idle loop paused while the bubble is open (fake timers).
- `lib/companion/brain.test.ts`: command vs agent-only vs chat routing; persona prompt assembly; history trimmed to 20.
- `electron/companionPlacement.test.ts`: dock strip from a work area, clamping across multiple displays, drop classification, position restore with a missing display.

Manual check with `npm run electron:dev`: clicks pass through transparent areas; hover/click/drag work; a system command ("open Calculator"), a chat question, and a voice request each produce the right states; the main window can be closed while Mini Me keeps working; unplugging a second display brings Mini Me back on screen.

---

## Out of Scope (v1)

- Shell, file and browsing actions from Mini Me (handed to Agent instead)
- Windows/Linux-specific polish (should work via Electron, but only macOS is verified)
- Climbing windows, following the mouse, multiple characters
- An in-app sprite editor or photo-to-sprite generation
