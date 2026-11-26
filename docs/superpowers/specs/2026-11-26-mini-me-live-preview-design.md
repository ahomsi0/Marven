# Mini Me — Just Tell Him, Live Preview, One Session per Project — Design Spec
_2026-11-26_

## Overview

Mini Me can already build a small project ("Build it here") and, since earlier today, change the project he built last. Three things still get in the way:

1. **Every request stops for a question.** A build asks "Build it here / Open in Marven / Just tell me", and a change asks "Change it here / Change in Marven / Just tell me". You can't fire off several changes; each one waits for a click.
2. **You can't see the site until it's finished**, and then only by opening it somewhere else. The result card is cramped (three buttons on two rows, a long summary).
3. **A project splits into several sessions.** Each Mini Me run starts with no history, and "Open in Marven" on a result card always creates a new Agent conversation, so a build and its later change end up as two empty conversations in Marven.

This spec removes the questions (you tell him and he does it, queuing what you add while he works), adds a live preview window next to him that you open when you want, and keeps one history per project that both Mini Me's runs and Marven's Agent conversation share.

It builds on the uncommitted work from earlier today: edit routing (`routeInput` → `edit`), the `[[EDIT]]` marker, the current-project store (`lib/companion/project.ts`), the reopen-project route, and the local project server (`electron/projectServer.js`).

---

## Design Decisions

| Decision | Choice |
|---|---|
| Asking before acting | Never for builds and changes. Mini Me starts and says what he's doing ("Building James Doe portfolio", "Changing James Doe portfolio") |
| New project vs. change | A build request for something buildable starts a new project. A change request (change/add/remove/make… plus a site word, or "it" right after he worked on the site) changes the current project. "No, make a new one" switches |
| Plain questions | Answered in chat as today |
| Messages while he works | Queued. When the run ends, all queued changes run together as one request; a queued new-project request runs on its own after them |
| Where work runs | In Mini Me (the existing background Agent run). Marven is reached with "Open in Marven" |
| Preview | A panel docked beside Mini Me's speech bubble (option C, revised), opened only when you click "Show preview"; it follows him and closes when the bubble closes |
| Preview content | The project folder served read-only on `127.0.0.1:<port>` by `electron/projectServer.js`; reloads after every file write |
| History | One thread per project folder (your requests and his summaries, last 20 messages), sent as `history` with every run on that folder |
| Open in Marven | Goes to the Agent conversation already on that folder (new only if none), and adds the thread messages it doesn't have yet |
| Approvals | Unchanged: file writes inside the project are approved by Mini Me; everything else is asked in the bubble |
| Out of scope | The "That's a job for Marven's Agent" hand-off for commands and file jobs outside a project keeps its "Open in Agent" button |

---

## 1. Talking to Mini Me

### Routing (`lib/companion/brain.ts`)

`routeInput` keeps its order (timer → clipboard → change → agent-only → build → command → chat) with these changes:

- **`build`** and **`edit`** no longer lead to a question. The page starts the run straight away.
- **Correction phrases**, checked first when Mini Me is working on, or just finished, a run started from your previous message:
  - "no, make a new one", "start a new project", "make it a separate site" → **`new-instead`**: stop the run if it's still going and start a new project with that previous request.
  - "no, just tell me", "don't build it" → **`chat-instead`**: stop the run if it's still going and answer that previous request in chat (as `skipBuild` does today).
  - "stop", "cancel" → **`stop`**.
- **Model markers**: when plain chat answers `[[BUILD: name]]` or `[[EDIT]]`, Mini Me acts on it directly, the same as the phrase routes.

The current-project rule from today stays: "it" means the project only within 30 minutes of Mini Me last working on it (`isRecentProject`). Site words ("background", "title", "contact section"…) mean the project at any time while one exists.

### The queue (`hooks/useCompanionBuild.ts`)

- While a run is active, a message routed to `build`, `edit`, `new-instead` or `chat-instead` is handled as follows. Corrections act at once. Builds and changes go into a queue shown in the bubble ("Next: add a contact form"). Chat questions are still answered in the bubble, without interrupting the run.
- When the run ends (done, failed or stopped), the queue drains in order:
  - consecutive changes to the same project become one run, with the requests as a numbered list ("Make these changes: 1. … 2. …");
  - a new-project request starts its own run.
- "Stop" clears the queue as well as the run.
- The queue lives in memory only; closing Mini Me drops it.

## 2. The Bubble

`app/companion/BuildCard.tsx` and `SpeechBubble.tsx`:

- **The choice buttons go**: "Build it here", "Open in Marven" and "Just tell me" on a build, and their change versions.
- **Working**: one line (pulse dot, "Building/Changing <name>", step count), the current step ("Writing index.html…"), the queue, the input, and two quiet actions: **Show preview** and **Stop**. Approval and conflict cards are unchanged.
- **Done**: a title ("James Doe portfolio is ready" / "is updated"), one short line from his summary (clamped to two lines, full text on hover), and two actions: **Show preview** (primary) and **Open in Marven** (icon button with a label tooltip). The folder moves into the preview window's toolbar. The input stays so you can carry on.
- **Failed / stopped / blocked**: as today, but with **Show preview** in place of "Open folder" when there are files to show.

## 3. The Preview Window

### Main process: `electron/previewWindow.js` (new)

- One preview panel at a time, for one project folder. Showing it for another folder switches it.
- A frameless, transparent, fixed-size (420×300) `BrowserWindow` with the companion window as its `parent`. It's a floating panel (`type: 'panel'` on macOS), always on top with Mini Me, with no taskbar entry, and it can't be moved on its own. It shares the app session, uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` and a minimal preload.
- **Docked to the bubble** (revised after testing, because a separate window felt detached): the companion page reports its speech bubble's rect (`companion:bubble-rect`, with a ResizeObserver). The panel sits beside the bubble with an 8 px gap and the bottom edges lined up, on the side with room, keeping its side while it still fits (`electron/previewPlacement.js`). It follows every move of the companion window (walk, drag, drop, resize) and hides when Mini Me hides.
- **Closes with the bubble**: a `null` bubble rect closes the panel. While the panel is open the bubble doesn't fade by itself, and the panel's own × closes only the panel (`companion:preview-closed` tells the page).
- It loads a Marven page, `/companion/preview`, holding the toolbar and an `<iframe>` of the served site. The app CSP (`electron/appCsp.js`) allows `frame-src http://127.0.0.1:*` for that route only. The iframe is sandboxed (`allow-scripts allow-forms`, no same-origin with Marven).
- IPC from the companion window only (same sender check as `companion:*`):
  - `companion:preview-show(root)`: `projectFolderInside` check, then `projectServer.urlFor(root)`, then create or reuse the window and focus it. Resolves to the URL or null.
  - `companion:preview-reload()`: reloads the iframe if the window is open. It's a no-op otherwise.
- IPC from the preview page (its own sender check): open the current URL in the default browser (`shell.openExternal`, loopback only), open the folder (`shell.openPath`, project folder only), open in Marven (the same hand-off as the bubble's button), and close.

### Preview page: `app/companion/preview/page.tsx` (new)

- Toolbar: close, reload, the project name and address (`127.0.0.1:55106`, read-only), open in browser, open in Marven, open folder. Marven's dark-theme tokens, 34 px high, inside a rounded panel matching the bubble.
- Body: the iframe, filling the rest of the window. Until the folder has an `index.html` it shows "Waiting for the first page…" (the project server's folder listing is not shown here).

### Live reload

Mini Me's build hook sends `preview-reload` after each `tool_result` for `write_file` or `apply_patch` inside the project, debounced to 300 ms, and once more on `done`. No file watching is needed.

## 4. One Session per Project

### Thread store (`lib/companion/project.ts`)

- New key `marven-companion-threads`: `{ [root]: ThreadMessage[] }`, where `ThreadMessage = { id, role: "user" | "assistant", content }`. Each project keeps its last 20 messages, and the store keeps the 10 most recently used projects.
- A run appends your request (or the batched list) when it starts, and the plain summary when it ends. A failed or stopped run appends a short note ("Stopped before finishing."), so the next run knows.
- `id` is `minime-<n>-<timestamp>`, unique within the thread.

### Runs send the history

`useCompanionBuild.start` passes the project's thread as `history` to `/api/agent/stream` (the route already accepts `history`). The build prompt for a change no longer has to say "you built this earlier"; the history shows it.

### Open in Marven reuses the conversation

- The hand-off payload sends the project's thread (with ids) and `workspaceRoot`.
- In `app/page.tsx`, a hand-off with a `workspaceRoot` and no `autostart`:
  - finds the most recent Agent conversation with that `workspaceRoot`. If there is one, it switches to it and appends the thread messages whose ids it doesn't already have. If there's none, it creates one with the thread;
  - opens the site preview as today (`queueSiteOpen`);
  - refuses with `busy` while the Agent is running (switching would abort it).
- The `edit` hand-off from today ("Change in Marven", request pre-filled) goes, since there is no change question any more.
- `electron/companionGuards.js` keeps the checks: the folder must be inside the projects folder, and `autostart` only on a fresh folder. `sanitizeThreadMessages` passes `id` through when it is a short string.

## 5. Error Handling

- **The preview can't be served** (folder gone, server failed to start): the bubble shows "I couldn't show the preview." and the run is unaffected.
- **The folder was deleted** between runs: the reopen-project route returns 404. Mini Me says the project is gone, forgets it as the current project, and treats the next build request as new.
- **The preview window is closed while he works**: reloads are no-ops, and "Show preview" opens it again.
- **The queue holds a change but the run failed**: the queued changes still run. The history note tells the Agent the last run didn't finish.
- **Open in Marven while Marven's Agent is busy**: "Marven's Agent is busy. Try again when it's done." No fallback build, since the work already happened here.

## 6. Testing

Unit (Vitest):

- `brain.test.ts`: corrections (`new-instead`, `chat-instead`, `stop`) only right after a run, and the routing table above, including the cases from today.
- `project.test.ts`: thread append, the 20-message and 10-project caps, ids, malformed storage.
- A pure queue helper (`lib/companion/queue.ts`): batching consecutive changes, a new project breaking the batch, stop clearing it.
- `companionGuards.test.ts`: thread ids passed through and capped. The `edit` option is removed.
- `previewPlacement`: docked beside the bubble (bottoms lined up), the side with room, no flipping while the side still fits, clamped to the display; bubble rects sanitized.
- `appCsp.test.ts`: `frame-src 127.0.0.1` on the preview route only.

End to end in the running app:

- Build a site, click Show preview, and watch sections appear as files are written.
- While he works, type two changes. Check they're queued, run together after the build, and land in the same folder.
- Click Open in Marven twice. There's one conversation on the folder, with the history.
- "No, make a new one" after a change starts: the change stops and a new folder is made.
- The preview's Open in browser opens the site at `127.0.0.1:<port>` in the default browser.
