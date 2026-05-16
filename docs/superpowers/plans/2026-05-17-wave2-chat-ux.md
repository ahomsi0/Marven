# Wave 2 — Chat UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add message edit/copy/retry, conversation search + pin, per-conversation system prompt, and markdown export to Marven.

**Architecture:** All new conversation state (`pinned`, `systemPrompt`) is stored as optional fields on the existing `Conversation` type and persisted through the existing `saveConversations` → localStorage path. Pure logic (search filter, markdown generator) lives in `lib/chatHelpers.ts` so it can be unit-tested with vitest. UI callbacks flow from `page.tsx` through `ChatLayout.tsx` down to `Message.tsx` and `Sidebar.tsx`.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, vitest (node environment, `@` alias resolves to project root).

---

## File Map

| File | Change |
|---|---|
| `types/index.ts` | Add `pinned?: boolean`, `systemPrompt?: string` to `Conversation` |
| `lib/chatHelpers.ts` | New file: `filterConversations`, `generateMarkdown` |
| `lib/chatHelpers.test.ts` | New file: vitest tests for the two helpers |
| `app/components/marven/Message.tsx` | Add copy (user), edit (user), retry (assistant) with `onEdit`, `onRetry`, `disabled` props |
| `app/components/marven/ChatLayout.tsx` | Thread `onEditMessage`, `onRetryMessage`, `onSystemPromptChange` props; add system prompt panel + export button in header |
| `app/components/marven/Sidebar.tsx` | Add search input, pinned section, pin toggle; thread `onPinConversation` prop |
| `app/page.tsx` | Add `handleEditMessage`, `handleRetryMessage`, `handlePinConversation`, `handleSystemPromptChange`; inject conversation system prompt into API calls |

---

## Task 1: Extend Conversation Type

**Files:**
- Modify: `types/index.ts:94-103`

- [ ] **Step 1: Add the two new optional fields**

Open `types/index.ts`. The `Conversation` interface currently ends at line 103. Replace it with:

```ts
export interface Conversation {
  id: string;
  name: string;
  mode?: ConversationMode;
  messages: Message[];
  createdAt: string; // ISO string for localStorage serialization
  updatedAt: string;
  provider?: AIProvider;
  model?: string;
  pinned?: boolean;
  systemPrompt?: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only pre-existing unrelated errors).

- [ ] **Step 3: Commit**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven"
git add types/index.ts
git commit -m "feat: add pinned and systemPrompt fields to Conversation type"
```

---

## Task 2: Pure Helpers — filterConversations & generateMarkdown

**Files:**
- Create: `lib/chatHelpers.ts`
- Create: `lib/chatHelpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/chatHelpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filterConversations, generateMarkdown } from "./chatHelpers";
import type { Conversation } from "@/types";

function makeConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "1",
    name: "Test",
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("filterConversations", () => {
  it("returns all when query is empty", () => {
    const convs = [makeConv({ name: "Alpha" }), makeConv({ id: "2", name: "Beta" })];
    expect(filterConversations(convs, "")).toHaveLength(2);
  });

  it("matches conversation name case-insensitively", () => {
    const convs = [makeConv({ name: "TypeScript tips" }), makeConv({ id: "2", name: "Python notes" })];
    expect(filterConversations(convs, "typescript")).toHaveLength(1);
    expect(filterConversations(convs, "typescript")[0].name).toBe("TypeScript tips");
  });

  it("matches message content", () => {
    const convs = [
      makeConv({ name: "Chat", messages: [{ id: "m1", role: "user", content: "hello world", timestamp: new Date(), isStreaming: false }] }),
      makeConv({ id: "2", name: "Other", messages: [] }),
    ];
    expect(filterConversations(convs, "world")).toHaveLength(1);
  });

  it("returns empty when nothing matches", () => {
    const convs = [makeConv({ name: "Alpha" })];
    expect(filterConversations(convs, "xyz")).toHaveLength(0);
  });
});

describe("generateMarkdown", () => {
  it("includes conversation name in heading", () => {
    const conv = makeConv({ name: "My Chat" });
    expect(generateMarkdown(conv)).toContain("# My Chat");
  });

  it("includes user and assistant messages", () => {
    const conv = makeConv({
      name: "Chat",
      messages: [
        { id: "1", role: "user", content: "Hello AI", timestamp: new Date(), isStreaming: false },
        { id: "2", role: "assistant", content: "Hello human", timestamp: new Date(), isStreaming: false },
      ],
    });
    const md = generateMarkdown(conv);
    expect(md).toContain("**You:** Hello AI");
    expect(md).toContain("**Assistant:** Hello human");
  });

  it("includes provider and model in header when present", () => {
    const conv = makeConv({ name: "Chat", provider: "groq", model: "llama-3.3-70b-versatile" });
    const md = generateMarkdown(conv);
    expect(md).toContain("Groq");
    expect(md).toContain("llama-3.3-70b-versatile");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx vitest run lib/chatHelpers.test.ts 2>&1 | tail -20
```

Expected: FAIL with `Cannot find module './chatHelpers'`.

- [ ] **Step 3: Implement lib/chatHelpers.ts**

Create `lib/chatHelpers.ts`:

```ts
import type { Conversation } from "@/types";

const PROVIDER_LABELS: Record<string, string> = {
  groq: "Groq",
  ollama: "Ollama",
  nim: "NIM",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/**
 * Filter conversations by name or message content.
 * Returns all conversations when query is empty.
 * Results are sorted by updatedAt descending.
 */
export function filterConversations(conversations: Conversation[], query: string): Conversation[] {
  const q = query.toLowerCase().trim();
  if (!q) return conversations;
  return conversations
    .filter(
      (conv) =>
        conv.name.toLowerCase().includes(q) ||
        conv.messages.some((m) => m.content.toLowerCase().includes(q))
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Generate a markdown export string from a conversation.
 * Tool messages (role not user/assistant) are omitted.
 */
export function generateMarkdown(conversation: Conversation): string {
  const date = new Date().toLocaleDateString([], {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const providerLabel = conversation.provider ? (PROVIDER_LABELS[conversation.provider] ?? conversation.provider) : "";
  const modelLabel = conversation.model ?? "";
  const metaParts = [providerLabel, modelLabel].filter(Boolean).join(" · ");

  let md = `# ${conversation.name || "Untitled"}\n`;
  md += `_Exported ${date}${metaParts ? ` · ${metaParts}` : ""}_\n\n---\n\n`;

  const chatMessages = conversation.messages.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );

  for (const msg of chatMessages) {
    const label = msg.role === "user" ? "**You:**" : "**Assistant:**";
    md += `${label} ${msg.content}\n\n---\n\n`;
  }

  return md;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx vitest run lib/chatHelpers.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven"
git add lib/chatHelpers.ts lib/chatHelpers.test.ts
git commit -m "feat: add filterConversations and generateMarkdown helpers with tests"
```

---

## Task 3: Message Actions — Copy (user), Edit (user), Retry (assistant)

**Files:**
- Modify: `app/components/marven/Message.tsx`
- Modify: `app/components/marven/ChatLayout.tsx`
- Modify: `app/page.tsx`

This task adds three new interactions in one cohesive change to avoid multiple partial edits to Message.tsx.

### 3a: Extend Message component

- [ ] **Step 1: Replace Message.tsx with the new version**

Replace the entire content of `app/components/marven/Message.tsx` with:

```tsx
"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message as ChatMessage } from "@/types";

interface MessageProps {
  message: ChatMessage;
  disabled?: boolean;
  onEdit?: (newContent: string) => void;   // user messages only
  onRetry?: () => void;                     // assistant messages only
}

export function Message({ message, disabled = false, onEdit, onRetry }: MessageProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard errors
    }
  }

  function handleEditSave() {
    const trimmed = editValue.trim();
    if (!trimmed) { setIsEditing(false); return; }
    setIsEditing(false);
    onEdit?.(trimmed);
  }

  function handleEditCancel() {
    setEditValue(message.content);
    setIsEditing(false);
  }

  const timeLabel = message.timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  // ─── Copy icon SVG ─────────────────────────────────────────────────────────
  const CopyIcon = () => copied ? (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  ) : (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );

  // ─── Pencil icon SVG ───────────────────────────────────────────────────────
  const PencilIcon = () => (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487z" />
    </svg>
  );

  // ─── Retry icon SVG ────────────────────────────────────────────────────────
  const RetryIcon = () => (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );

  // Shared action button style
  function actionBtn(title: string, onClick: () => void, children: ReactNode) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        title={title}
        className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#252525] border border-[#383838] text-[#777] shadow transition-all duration-150 hover:bg-[#2a2a2a] hover:text-[#ccc] disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {children}
      </button>
    );
  }

  return (
    <div className={`message-in group flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      {isUser ? (
        <div className="relative max-w-[86%] sm:max-w-[78%]">
          {isEditing ? (
            /* ── Edit mode ── */
            <div className="flex flex-col gap-2">
              <textarea
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditSave(); }
                  if (e.key === "Escape") handleEditCancel();
                }}
                rows={3}
                className="w-full resize-none rounded-2xl rounded-br-sm border border-[#d19a66]/40 bg-[#252525] px-4 py-3 text-[14px] text-[#d4d4d4] leading-7 outline-none focus:border-[#d19a66]/60"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleEditCancel}
                  className="rounded-md border border-[#383838] px-3 py-1 text-[11px] text-[#666] hover:text-[#999]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleEditSave}
                  className="rounded-md border border-[#d19a66]/30 bg-[#d19a66]/10 px-3 py-1 text-[11px] text-[#d19a66] hover:bg-[#d19a66]/20"
                >
                  Save & Resend
                </button>
              </div>
            </div>
          ) : (
            /* ── Display mode ── */
            <>
              <div className="bg-[#252525] border border-[#383838] border-l border-l-[#d19a66]/20 rounded-2xl rounded-br-sm px-4 py-3">
                <p className="text-[14px] text-[#d4d4d4] leading-7 whitespace-pre-wrap break-words">
                  {message.content}
                </p>
              </div>
              {/* Action bar — top-right, visible on hover */}
              <div className="absolute -right-2 -top-2 z-10 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {actionBtn("Edit message", () => { setEditValue(message.content); setIsEditing(true); }, <PencilIcon />)}
                {actionBtn(copied ? "Copied!" : "Copy", handleCopy, <CopyIcon />)}
              </div>
              {/* Timestamp shown on hover */}
              <span className="mt-1 block text-right text-[10px] text-[#555] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {timeLabel}
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="relative max-w-[88%] sm:max-w-[82%]">
          {/* Action bar — top-right, visible on hover */}
          <div className="absolute -right-2 -top-2 z-10 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {onRetry && actionBtn("Retry", onRetry, <RetryIcon />)}
            {actionBtn(copied ? "Copied!" : "Copy", handleCopy, <CopyIcon />)}
          </div>

          <div className="pl-3 border-l border-[#333]">
            <div className="text-[14px] text-[#d4d4d4] leading-7">
              {message.isStreaming && !message.content ? (
                <span className="streaming-cursor" />
              ) : (
                <div className="prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                  {message.isStreaming && (
                    <span className="streaming-cursor" />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Timestamp shown on hover */}
          <span className="mt-1 block pl-4 text-left text-[10px] text-[#555] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {timeLabel}
          </span>
        </div>
      )}
    </div>
  );
}
```

### 3b: Add callbacks to ChatLayout

- [ ] **Step 2: Add new props to ChatLayoutProps and thread them to Message**

In `app/components/marven/ChatLayout.tsx`, make the following changes:

**Add to `ChatLayoutProps` interface** (after the existing `onRefreshAgentFiles` line):
```ts
  onEditMessage: (id: string, newContent: string) => void;
  onRetryMessage: (id: string) => void;
```

**Add to the destructured parameters** of `ChatLayout` (after `onRefreshAgentFiles`):
```ts
  onEditMessage,
  onRetryMessage,
```

**Replace the Message rendering line** (currently `<Message key={message.id} message={message} />`):
```tsx
<Message
  key={message.id}
  message={message}
  disabled={isLoading}
  onEdit={message.role === "user" ? (content) => onEditMessage(message.id, content) : undefined}
  onRetry={message.role === "assistant" ? () => onRetryMessage(message.id) : undefined}
/>
```

### 3c: Add handlers in page.tsx

- [ ] **Step 3: Add handleEditMessage and handleRetryMessage to page.tsx**

In `app/page.tsx`, add these two functions after `handleClearChat` (around line 951):

```ts
async function handleEditMessage(messageId: string, newContent: string) {
  if (!activeConversationId || isLoading) return;
  const conv = conversations.find((c) => c.id === activeConversationId);
  if (!conv) return;
  const idx = conv.messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;
  // Truncate: remove the edited message and everything after it
  upsertConversation(activeConversationId, (c) => ({
    ...c,
    messages: c.messages.slice(0, idx),
    updatedAt: new Date().toISOString(),
  }));
  // sendMessage will add the user message fresh and get the AI reply
  await sendMessage(newContent);
}

async function handleRetryMessage(messageId: string) {
  if (!activeConversationId || isLoading) return;
  const conv = conversations.find((c) => c.id === activeConversationId);
  if (!conv) return;
  const idx = conv.messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;
  // Find the user message immediately before this assistant message
  let userContent = "";
  let userIdx = -1;
  for (let i = idx - 1; i >= 0; i--) {
    if (conv.messages[i].role === "user") {
      userContent = conv.messages[i].content;
      userIdx = i;
      break;
    }
  }
  if (userIdx === -1) return;
  // Truncate: remove from the user message onwards
  upsertConversation(activeConversationId, (c) => ({
    ...c,
    messages: c.messages.slice(0, userIdx),
    updatedAt: new Date().toISOString(),
  }));
  await sendMessage(userContent);
}
```

- [ ] **Step 4: Pass the new handlers to ChatLayout in page.tsx**

In the `<ChatLayout ...>` JSX in `app/page.tsx`, add after `onDeleteConversation={handleDeleteConversation}`:

```tsx
onEditMessage={handleEditMessage}
onRetryMessage={handleRetryMessage}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 6: Smoke-test manually**

Run `npm run dev`, open the app, send a message, hover the user message → pencil + copy icons appear. Click pencil → textarea appears with existing text. Edit and save → new AI response. Hover assistant message → retry + copy icons appear. Retry → new response generated.

- [ ] **Step 7: Commit**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven"
git add app/components/marven/Message.tsx app/components/marven/ChatLayout.tsx app/page.tsx
git commit -m "feat: add message edit, user copy, and retry actions"
```

---

## Task 4: Sidebar Enhancements — Search + Pin

**Files:**
- Modify: `app/components/marven/Sidebar.tsx`
- Modify: `app/components/marven/ChatLayout.tsx`
- Modify: `app/page.tsx`

### 4a: Rewrite Sidebar with search + pin

- [ ] **Step 1: Replace Sidebar.tsx with the new version**

Replace the entire content of `app/components/marven/Sidebar.tsx` with:

```tsx
"use client";

import { useState } from "react";
import type { Conversation } from "@/types";
import { MarvenLogo } from "./MarvenLogo";
import { filterConversations } from "@/lib/chatHelpers";

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  isOpen: boolean;
  onNewChat: () => void;
  onNewAgent: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onPinConversation: (id: string, pinned: boolean) => void;
  onOpenSettings: () => void;
}

function relativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function groupConversations(
  conversations: Conversation[]
): { label: string; items: Conversation[] }[] {
  const groups: Record<string, Conversation[]> = {};
  for (const conv of [...conversations].reverse()) {
    const label = relativeDate(conv.updatedAt);
    if (!groups[label]) groups[label] = [];
    groups[label].push(conv);
  }
  return Object.entries(groups).map(([label, items]) => ({ label, items }));
}

function ConvRow({
  conv,
  isActive,
  onSelect,
  onDelete,
  onPin,
}: {
  conv: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onPin: () => void;
}) {
  return (
    <div
      className={`group relative flex cursor-pointer items-center rounded-md px-2 py-1.5 transition-colors ${
        isActive
          ? "bg-[#2a2a2a] text-[#d4d4d4]"
          : "text-[#888] hover:text-[#ccc] hover:bg-[#252525]"
      }`}
      onClick={onSelect}
    >
      {conv.pinned && (
        <span className="mr-1.5 text-[#d19a66]/60">
          <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M16 2v11l2 2v2H6v-2l2-2V2h8zm-2 0H10v10.586L8 14.586V15h8v-.414L14 12.586V2z" />
            <path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2z" />
          </svg>
        </span>
      )}
      <span className="flex-1 truncate pr-9 text-[13px]">
        {conv.name || "Untitled"}
      </span>
      {conv.mode === "agent" && (
        <span className="mr-1 rounded-full border border-[#d19a66]/20 bg-[#d19a66]/08 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-[#d19a66]">
          Agent
        </span>
      )}

      {/* Pin button — shown on hover */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onPin(); }}
        aria-label={conv.pinned ? "Unpin conversation" : "Pin conversation"}
        title={conv.pinned ? "Unpin" : "Pin"}
        className={`absolute right-6 top-1/2 -translate-y-1/2 rounded px-0.5 py-0.5 text-[11px] opacity-0 transition-opacity group-hover:opacity-100 ${
          conv.pinned ? "text-[#d19a66]/70 hover:text-[#d19a66]" : "text-[#555] hover:text-[#888]"
        }`}
      >
        <svg className="h-3 w-3" fill={conv.pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5z" />
        </svg>
      </button>

      {/* Delete button */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        aria-label="Delete conversation"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 py-0.5 text-[11px] text-[#666] opacity-0 transition-opacity hover:text-red-500/80 group-hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

export function Sidebar({
  conversations,
  activeConversationId,
  isOpen,
  onNewChat,
  onNewAgent,
  onSelectConversation,
  onDeleteConversation,
  onPinConversation,
  onOpenSettings,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const pinnedConvs = conversations.filter((c) => c.pinned);
  const unpinnedConvs = conversations.filter((c) => !c.pinned);

  const isSearching = searchQuery.trim().length > 0;
  const searchResults = isSearching ? filterConversations(conversations, searchQuery) : null;
  const grouped = isSearching ? null : groupConversations(unpinnedConvs);

  return (
    <aside
      className={`flex h-full flex-col bg-[#1a1a1a] border-r border-[#333] transition-all duration-200 ${
        isOpen ? "w-[220px] min-w-[220px]" : "w-0 min-w-0 overflow-hidden"
      }`}
    >
      {isOpen && (
        <>
          {/* Brand */}
          <div className="flex flex-col px-4 pb-3 pt-5">
            <div className="flex items-center gap-2">
              <MarvenLogo size={28} />
              <span className="text-[15px] font-semibold text-[#d4d4d4]">
                Marven
              </span>
            </div>
            <span className="mt-0.5 text-[11px] text-[#555]">
              assistant + agent
            </span>
          </div>

          <div className="mx-3 mb-3 h-px bg-[#2a2a2a]" />

          {/* New chat */}
          <button
            type="button"
            onClick={onNewChat}
            className="mx-3 mb-2 border border-[#383838] text-[#888] rounded-lg px-3 py-1.5 text-[12px] hover:border-[#555] hover:text-[#d4d4d4] hover:bg-[#252525] transition-all"
          >
            + New chat
          </button>
          <button
            type="button"
            onClick={onNewAgent}
            className="mx-3 mb-3 border border-[#d19a66]/25 bg-[#d19a66]/08 text-[#d19a66] rounded-lg px-3 py-1.5 text-[12px] hover:border-[#d19a66]/40 hover:bg-[#d19a66]/12 transition-all"
          >
            + New agent
          </button>

          {/* Search */}
          <div className="mx-3 mb-2">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[#555]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
              </svg>
              <input
                type="text"
                placeholder="Search…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-[#2a2a2a] bg-[#161616] py-1.5 pl-7 pr-3 text-[11px] text-[#888] placeholder-[#444] outline-none focus:border-[#383838] focus:text-[#ccc]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#444] hover:text-[#888]"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Conversation list */}
          <div className="min-h-0 flex-1 overflow-y-auto px-2">
            {isSearching ? (
              /* ── Search results (flat) ── */
              searchResults!.length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-[#555]">No results</p>
              ) : (
                searchResults!.map((conv) => (
                  <ConvRow
                    key={conv.id}
                    conv={conv}
                    isActive={conv.id === activeConversationId}
                    onSelect={() => onSelectConversation(conv.id)}
                    onDelete={() => onDeleteConversation(conv.id)}
                    onPin={() => onPinConversation(conv.id, !conv.pinned)}
                  />
                ))
              )
            ) : (
              /* ── Normal grouped view ── */
              <>
                {/* Pinned section */}
                {pinnedConvs.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1 px-2 text-[10px] uppercase tracking-wider font-medium text-[#555]">
                      Pinned
                    </p>
                    {pinnedConvs.map((conv) => (
                      <ConvRow
                        key={conv.id}
                        conv={conv}
                        isActive={conv.id === activeConversationId}
                        onSelect={() => onSelectConversation(conv.id)}
                        onDelete={() => onDeleteConversation(conv.id)}
                        onPin={() => onPinConversation(conv.id, false)}
                      />
                    ))}
                  </div>
                )}

                {/* Date-grouped unpinned conversations */}
                {grouped!.length === 0 && pinnedConvs.length === 0 && (
                  <p className="px-2 text-[12px] text-[#555]">No conversations yet</p>
                )}
                {grouped!.map(({ label, items }) => (
                  <div key={label} className="mb-3">
                    <p className="mb-1 px-2 text-[10px] uppercase tracking-wider font-medium text-[#555]">
                      {label}
                    </p>
                    {items.map((conv) => (
                      <ConvRow
                        key={conv.id}
                        conv={conv}
                        isActive={conv.id === activeConversationId}
                        onSelect={() => onSelectConversation(conv.id)}
                        onDelete={() => onDeleteConversation(conv.id)}
                        onPin={() => onPinConversation(conv.id, true)}
                      />
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Settings gear at bottom */}
          <div className="border-t border-[#2a2a2a] px-3 py-3">
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12px] text-[#666] transition-colors hover:bg-[#252525] hover:text-[#999]"
            >
              <svg
                className="h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                />
              </svg>
              Settings
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
```

### 4b: Thread onPinConversation through ChatLayout

- [ ] **Step 2: Add onPinConversation to ChatLayoutProps and pass to Sidebar**

In `app/components/marven/ChatLayout.tsx`:

**Add to `ChatLayoutProps` interface** (after `onDeleteConversation`):
```ts
  onPinConversation: (id: string, pinned: boolean) => void;
```

**Add to the destructured parameters** (after `onDeleteConversation`):
```ts
  onPinConversation,
```

**Add to the `<Sidebar>` JSX** (after `onDeleteConversation={onDeleteConversation}`):
```tsx
onPinConversation={onPinConversation}
```

### 4c: Add handler in page.tsx

- [ ] **Step 3: Add handlePinConversation to page.tsx**

In `app/page.tsx`, add after `handleDeleteConversation`:

```ts
function handlePinConversation(id: string, pinned: boolean) {
  upsertConversation(id, (conv) => ({ ...conv, pinned }));
}
```

**Add to the `<ChatLayout>` JSX** (after `onDeleteConversation={handleDeleteConversation}`):
```tsx
onPinConversation={handlePinConversation}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 5: Smoke-test manually**

Run `npm run dev`. Type in search box → conversations filter. Clear → groups restored. Hover conversation → pin (star) icon appears. Click → conversation moves to Pinned section. Click again → returns to date groups.

- [ ] **Step 6: Commit**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven"
git add app/components/marven/Sidebar.tsx app/components/marven/ChatLayout.tsx app/page.tsx
git commit -m "feat: add conversation search and pin to sidebar"
```

---

## Task 5: Per-Conversation System Prompt Editor

**Files:**
- Modify: `app/components/marven/ChatLayout.tsx`
- Modify: `app/page.tsx`

### 5a: Add system prompt panel to ChatLayout

- [ ] **Step 1: Add new props and local state to ChatLayout**

In `app/components/marven/ChatLayout.tsx`:

**Add to `ChatLayoutProps`** (after `onPinConversation`):
```ts
  conversationSystemPrompt: string;
  onSystemPromptChange: (value: string) => void;
```

**Add to the destructured parameters** (after `onPinConversation`):
```ts
  conversationSystemPrompt,
  onSystemPromptChange,
```

**Add local state** inside the `ChatLayout` function body (after the existing `useState` calls):
```ts
const [systemPromptOpen, setSystemPromptOpen] = useState(false);
```

- [ ] **Step 2: Add system prompt icon + inline panel to the chat header**

In `ChatLayout.tsx`, find the header `<div className="flex items-center justify-between gap-3">`. The right side currently only has the token count. Replace that right-side `<div>` with:

```tsx
<div className="flex items-center gap-2">
  {/* System prompt toggle — only in chat mode */}
  {mode === "chat" && (
    <button
      type="button"
      onClick={() => setSystemPromptOpen((v) => !v)}
      title="System prompt"
      aria-label="Edit system prompt"
      className={`rounded-lg p-1.5 transition-colors hover:bg-[#2a2a2a] ${
        conversationSystemPrompt
          ? "text-[#d19a66]"
          : systemPromptOpen
          ? "text-[#999]"
          : "text-[#555] hover:text-[#999]"
      }`}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    </button>
  )}

  <div className="text-[11px] text-[#666]">
    {tokenUsage.totalTokens.toLocaleString()} tokens
  </div>
</div>
```

- [ ] **Step 3: Add the inline system prompt panel below the header row**

In `ChatLayout.tsx`, find the closing `</div>` that ends the `<div className={`mx-auto w-full space-y-2.5 ...`}>` wrapper. Just before it, add:

```tsx
{/* System prompt panel */}
{mode === "chat" && systemPromptOpen && (
  <div className="flex flex-col gap-1.5">
    <label className="text-[10px] uppercase tracking-wider text-[#555]">
      System prompt for this conversation
    </label>
    <textarea
      rows={3}
      placeholder="Give this conversation a persona or set of instructions… (e.g. 'Answer only in French' or 'You are a Python expert')"
      value={conversationSystemPrompt}
      onChange={(e) => onSystemPromptChange(e.target.value)}
      className="w-full resize-none rounded-lg border border-[#2a2a2a] bg-[#161616] px-3 py-2 text-[12px] text-[#ccc] placeholder-[#444] outline-none focus:border-[#383838]"
    />
  </div>
)}
```

### 5b: Wire system prompt in page.tsx

- [ ] **Step 4: Derive and handle conversationSystemPrompt in page.tsx**

In `app/page.tsx`, add this function after `handlePinConversation`:

```ts
function handleSystemPromptChange(value: string) {
  if (!activeConversationId) return;
  upsertConversation(activeConversationId, (conv) => ({
    ...conv,
    systemPrompt: value,
  }));
}
```

**Derive the current conversation's system prompt** near the existing `activeConversation` derivation (around line 163):

```ts
const conversationSystemPrompt = activeConversation?.systemPrompt ?? "";
```

- [ ] **Step 5: Inject conversation system prompt into API calls**

In `app/page.tsx`, find the two places where `buildSystemPrompt` is called in `sendMessage` and replace each with:

```ts
// Replace:
systemPrompt: buildSystemPrompt(userProfile?.name ?? null, memories),
// With:
systemPrompt: (() => {
  const base = buildSystemPrompt(userProfile?.name ?? null, memories);
  const extra = activeConversation?.systemPrompt?.trim();
  return extra ? `${base}\n\n---\n\nAdditional instructions:\n${extra}` : base;
})(),
```

There are two occurrences of `systemPrompt: buildSystemPrompt(...)` in `sendMessage` — one for server-side commands (line ~764) and one for the main AI call (line ~795). Replace both.

- [ ] **Step 6: Pass new props to ChatLayout in page.tsx**

In the `<ChatLayout>` JSX, add:
```tsx
conversationSystemPrompt={conversationSystemPrompt}
onSystemPromptChange={handleSystemPromptChange}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 8: Smoke-test manually**

Run `npm run dev`. In a chat, click the chat-bubble icon in the header → system prompt textarea appears. Type "Always respond in the style of a pirate." Send a message → AI responds in pirate style. Switch to another conversation → system prompt is empty (per-conversation). Switch back → pirate prompt restored.

- [ ] **Step 9: Commit**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven"
git add app/components/marven/ChatLayout.tsx app/page.tsx
git commit -m "feat: add per-conversation system prompt editor"
```

---

## Task 6: Markdown Export

**Files:**
- Modify: `app/components/marven/ChatLayout.tsx`

- [ ] **Step 1: Import generateMarkdown in ChatLayout.tsx**

At the top of `app/components/marven/ChatLayout.tsx`, add to the existing imports:

```ts
import { generateMarkdown } from "@/lib/chatHelpers";
```

- [ ] **Step 2: Add the export function and button inside ChatLayout**

Inside the `ChatLayout` function body, add this helper (after the existing `handleSlashCommand` function):

```ts
function handleExport() {
  const conv = conversations.find((c) => c.id === activeConversationId);
  if (!conv || conv.messages.length === 0) return;
  const md = generateMarkdown(conv);
  const slug = (conv.name || "conversation")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const blob = new Blob([md], { type: "text/markdown; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Add export button to the header**

In the header right-side `<div className="flex items-center gap-2">`, add this button before the system prompt button:

```tsx
{/* Export button — only in chat mode, only when there are messages */}
{mode === "chat" && messages.length > 0 && (
  <button
    type="button"
    onClick={handleExport}
    title="Export as Markdown"
    aria-label="Export conversation as Markdown"
    className="rounded-lg p-1.5 text-[#555] transition-colors hover:bg-[#2a2a2a] hover:text-[#999]"
  >
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  </button>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 5: Run all tests**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Smoke-test manually**

Run `npm run dev`. Send a few messages. Click the download arrow icon in the header → browser downloads a `.md` file. Open file → contains conversation name, date, provider, model, and all user/assistant messages.

- [ ] **Step 7: Commit**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven"
git add app/components/marven/ChatLayout.tsx
git commit -m "feat: add markdown export for conversations"
```
