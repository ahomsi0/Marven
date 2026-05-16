# Wave 2 — Chat UX Design

## Overview

Six chat UX features delivered as one cohesive plan: message editing, copy/retry actions, conversation search, pinned conversations, per-conversation system prompt, and markdown export.

---

## Architecture & Data Model

Two new optional fields on `Conversation` in `types/index.ts` (backward compatible — existing conversations without these fields behave identically to today):

```ts
export interface Conversation {
  id: string;
  name: string;
  mode?: ConversationMode;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  provider?: AIProvider;
  model?: string;
  // NEW
  pinned?: boolean;
  systemPrompt?: string;
}
```

No new storage mechanism. Both fields persist via the existing `saveConversations` → localStorage path in `app/page.tsx`.

Message edit state lives in `ChatPanel` (or whichever component owns the message list) as local React state: `editingMessageId: string | null`. No new global/context state needed.

---

## Feature 1: Message Edit

**UX:** Hovering any user message bubble reveals a small action bar (top-right corner, fade-in). The action bar for user messages contains a pencil icon and a copy icon.

**Edit flow:**
1. Click pencil icon → the message bubble is replaced by a `<textarea>` pre-filled with the existing text, plus "Save & Resend" and "Cancel" buttons below it.
2. **Save & Resend** → truncates all messages after the edited one from `conversation.messages`, updates the edited message's `content`, then calls the existing `handleSend` path (re-submit). Persists to localStorage.
3. **Cancel** → restores the original bubble, clears `editingMessageId`.

**Constraints:**
- Any user message in the conversation is editable (not just the last one).
- Editing truncates all subsequent messages (both user and assistant) — no branching.
- The re-submit reuses the exact same send path — no new API logic.

---

## Feature 2: Copy & Retry

**Copy (user messages):** The hover action bar on user messages includes a copy icon. Copies `message.content` to clipboard. Mirrors the existing copy button already on assistant messages.

**Retry (assistant messages):** The hover action bar on assistant messages gets a retry icon (↺) in addition to the existing copy icon.

**Retry flow:**
1. Click ↺ on an assistant message → removes that assistant message and all messages after it from `conversation.messages`.
2. The user message immediately preceding it becomes the new tail.
3. Re-submits via the existing `handleSend` path.
4. Persists to localStorage.

No new API logic — retry is purely a slice-and-resubmit operation on the messages array.

---

## Feature 3: Conversation Search

**UX:** A search input field at the top of the sidebar, directly below the "New Chat" button. Always visible (not behind a toggle icon).

**Behavior:**
- Filters the conversation list client-side on every keystroke — no debounce needed at local scale.
- Matches against: conversation `name` and any `message.content` in the conversation (case-insensitive substring match).
- When a query is active: date grouping is hidden, results shown as a flat list sorted by `updatedAt` desc.
- Clearing the input restores the normal date-grouped view.
- Pinned conversations are not separated from results when searching — they appear inline with other matches.

**Implementation:** Pure derived computation from the existing `conversations` array. No index, no background worker.

---

## Feature 4: Pinned Conversations

**UX:** Hovering a conversation row in the sidebar reveals a pin icon alongside the existing delete icon.

**Pin toggle:**
- Click pin icon → sets `conversation.pinned = true`, persists to localStorage, re-renders sidebar.
- Clicking again → sets `conversation.pinned = false`.
- Pinned icon shown filled/gold when `pinned === true`, outline when hovered on an unpinned conversation.

**Sidebar layout with pins:**
- A "Pinned" section appears at the very top, above all date groups, containing all conversations where `pinned === true`, sorted by `updatedAt` desc.
- Only shown when at least one conversation is pinned.
- When searching, pinned status is ignored for grouping — all results appear flat.

---

## Feature 5: Per-Conversation System Prompt

**UX:** A small icon (sliders or similar) in the chat header bar, next to the model dropdown.

**Editor:**
- Clicking the icon opens a compact inline panel that slides/fades in below the header.
- Contains a `<textarea>` with placeholder: `"Give this conversation a system prompt…"`
- Saves on blur — no explicit save button.
- Stored as `conversation.systemPrompt` and persists to localStorage.
- Clicking the icon again (or clicking outside) closes the panel.

**API injection:**
- Before every API call (chat and agent modes), if `conversation.systemPrompt` is non-empty, inject `{ role: "system", content: systemPrompt }` as the first entry in the messages array sent to the provider.
- All six providers already handle a system message at position 0 — no provider-level changes needed.
- If `systemPrompt` is empty or undefined, no system message is injected (identical to current behavior).

---

## Feature 6: Markdown Export

**UX:** A download icon in the chat header bar, next to the system prompt icon.

**Behavior:**
- Clicking generates a `.md` string client-side from `conversation.messages`.
- Triggers a browser download via `URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))` + a programmatically clicked hidden `<a>` element.
- Filename: `<conversation-name>.md` (slugified).
- No server round-trip, no new API route.

**Output format:**
```
# <Conversation Name>
_Exported 2026-05-17 · <Provider Label> · <Model Name>_

---

**You:** <user message content>

**Assistant:** <assistant message content>

---
```

Tool call messages (role: `tool_call`, `tool_result`) are omitted from the export — only `user` and `assistant` roles are included.

---

## Files Touched

| File | Change |
|---|---|
| `types/index.ts` | Add `pinned?: boolean`, `systemPrompt?: string` to `Conversation` |
| `app/components/marven/Message.tsx` | Add hover action bar with edit/copy/retry icons |
| `app/components/marven/ChatLayout.tsx` | Edit state, handleEdit, handleRetry; system prompt icon + panel; export icon |
| `app/page.tsx` | System prompt injection before API calls; handleEdit/handleRetry handlers |
| `app/components/marven/Sidebar.tsx` | Search input, pinned section, pin toggle |

---

## Error Handling

- **Edit while streaming:** Disable edit/retry icons while a response is in-flight (`isStreaming` state already exists).
- **Empty edit:** If user saves an empty message, treat as cancel.
- **Export with no messages:** Button is disabled or produces a minimal file with just the header.
- **System prompt too long:** No enforced limit — provider will return an error if context is exceeded, surfaced via existing error handling.

---

## Testing

- Edit a middle message → verify subsequent messages are removed and AI responds to the edited version.
- Retry an assistant message → verify only that response is removed and re-generated.
- Search matches name and message content; clearing restores groups.
- Pin a conversation → appears in Pinned section; unpin → returns to date group.
- System prompt set → injected in API call (verify via network tab); cleared → not injected.
- Export → downloaded file contains correct conversation content, tool messages omitted.
