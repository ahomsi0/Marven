# Wave 3 — Agent Power & Multimodal Design

## Overview

Six features delivered as one cohesive wave: image attachments in chat, two new agent tools (web_search + fetch_url), expandable tool call cards, MCP server support, conversation memory, and user-defined slash command templates.

---

## Architecture & Data Model

Three new types added to `types/index.ts`. All changes are backward compatible — existing conversations and settings load without migration.

```ts
export interface ImageAttachment {
  base64: string;     // full data URL (e.g. "data:image/png;base64,...")
  mimeType: string;   // "image/png" | "image/jpeg" | "image/webp" | "image/gif"
  name: string;       // original filename, e.g. "screenshot.png"
}

export interface MCPServer {
  id: string;         // uuid generated on creation
  name: string;       // user-assigned label, e.g. "filesystem"
  command: string;    // full shell command, e.g. "npx @modelcontextprotocol/server-filesystem ~/"
  enabled: boolean;
}

export interface PromptTemplate {
  id: string;         // uuid generated on creation
  trigger: string;    // slash keyword, e.g. "review" → accessible as /review
  prompt: string;     // text that fills the input on selection
  label?: string;     // display name shown in the slash menu
}
```

**Message type extension** (one new optional field):

```ts
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  attachments?: ImageAttachment[];   // NEW
}
```

**Storage:**
- `MCPServer[]` persists in localStorage under key `marven_mcp_servers`, managed alongside existing settings in `app/page.tsx`.
- `PromptTemplate[]` persists in localStorage under key `marven_prompt_templates`.
- Memory lives in `~/.marven/memory.md` on disk, read/written via Electron IPC.

---

## Feature 1: Image Attachments

### Input

Three entry points in `InputBar`, all producing `ImageAttachment[]`:

1. **Paperclip button** — file picker (`accept="image/*"`), supports multi-select.
2. **Paste** — `onPaste` handler reads `ClipboardEvent.clipboardData.items` for `image/*` items.
3. **Drag and drop** — `onDrop` handler on the InputBar container.

All three convert the raw `File` / `Blob` to a base64 data URL via `FileReader.readAsDataURL`.

**Preview strip:** When `attachments.length > 0`, a strip renders above the textarea showing one thumbnail per attachment (44×44px, `object-fit: cover`, rounded). Each thumbnail has an × button to remove it. The strip is hidden when empty.

**Send:** Attachments are passed from InputBar → ChatLayout → page.tsx alongside the text. They are stored on the `Message` object and included in the API call payload.

### Message Bubble

In `Message.tsx`, user messages with `attachments` render the first attachment as a 48×48px thumbnail on the left side of the bubble content, with the text to the right. Multiple attachments stack vertically on the left (48px wide each). No lightbox in Wave 3 — images are decorative thumbnails only.

### API

In `app/api/chat/route.ts`, before building the provider request, any message with `attachments` is converted to a multi-part content array:

**OpenAI / Groq (vision-capable models):**
```json
[
  { "type": "text", "text": "What's wrong with this layout?" },
  { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
]
```

**Anthropic:**
```json
[
  { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } },
  { "type": "text", "text": "What's wrong with this layout?" }
]
```

**Ollama / NIM / non-vision providers:** Images are stripped. A note is appended to the message text: `\n\n[Image attachment removed — this provider does not support vision.]`

Vision-capable provider+model combinations are tracked in a `VISION_PROVIDERS` set in the chat route: `groq`, `openai`, `anthropic`. Ollama and NIM are excluded (too model-specific to detect reliably).

---

## Feature 2: Agent Tools — web_search & fetch_url

Two new tools added to the built-in tool registry in `app/api/agent/stream/route.ts`.

### `web_search`

```ts
{
  name: "web_search",
  description: "Search the web for information. Returns abstracts, top results, and related topics.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" }
    },
    required: ["query"]
  }
}
```

**Implementation:** Calls `https://api.duckduckgo.com/?q={query}&format=json&no_html=1&skip_disambig=1`. Free, no API key. Extracts: `AbstractText`, `AbstractURL`, and up to 5 `RelatedTopics` (title + URL). Returns a plain-text formatted summary.

### `fetch_url`

```ts
{
  name: "fetch_url",
  description: "Fetch the content of a URL and return it as plain text.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch" }
    },
    required: ["url"]
  }
}
```

**Implementation:** Server-side `fetch(url)` with a 10-second timeout. Strips HTML tags with a regex (`/<[^>]+>/g`), collapses whitespace, truncates to 8000 characters. Returns the plain text. On non-2xx response, returns the status code and status text as an error string.

Both tools execute in the existing tool dispatch switch in the agent stream route — same error handling pattern as `run_command`.

---

## Feature 3: Expandable Tool Call Cards

`ToolCallCard` gains a local `expanded` boolean state (default `false`).

**Collapsed state (unchanged):** icon + tool name + arg summary + status indicator — identical to today.

**Expanded state:** Clicking the card header toggles `expanded`. A ▼/▲ chevron appears in the top-right next to the status indicator (only shown once status is `done` or `error` — not during `running`).

Expanded content renders below the header, separated by a border:
- **Input section:** label "INPUT", the full `args` object rendered as `JSON.stringify(args, null, 2)` in a monospace pre block.
- **Output section:** label "OUTPUT", the full `output` string in a monospace pre block. If output exceeds 300px height, the block scrolls internally (`overflow-y: auto`, `max-height: 300px`).

No truncation with "show more" — the scroll container handles long output.

---

## Feature 4: MCP Server Support

### Architecture note

The Next.js API routes in Marven already use Node.js `child_process` and `fs` directly (as seen in the existing agent route). MCP server management follows the same pattern — a module-level Node.js singleton in `lib/mcpClient.ts`, imported directly by the agent route. No Electron IPC needed; the API route context has full Node.js access.

### `lib/mcpClient.ts` (new file)

A module-level singleton (`MCPClient`) that manages MCP server child processes:

- **`start(server: MCPServer)`** — spawns `server.command` via `child_process.spawn({ shell: true })`. Holds stdin/stdout pipes open. Sends the MCP `initialize` JSON-RPC request and awaits the response. Stores the process + state in a map keyed by `server.id`.
- **`stop(id: string)`** — kills the process, removes from map.
- **`listTools(id: string)`** — sends `tools/list` JSON-RPC, returns `ToolDefinition[]`.
- **`callTool(id: string, tool: string, args: object)`** — sends `tools/call` JSON-RPC, awaits result, returns output string. 30-second timeout.
- **`getStatus()`** — returns `Record<string, "connected" | "disconnected">` for all configured servers.

JSON-RPC framing: newline-delimited JSON objects over stdio. A response correlator matches `id` fields to pending promises using a `Map<number, { resolve, reject }>`.

### `/api/mcp/route.ts` (new file)

REST API for the settings UI:
- `GET /api/mcp` — returns `mcpClient.getStatus()`
- `POST /api/mcp` — body `{ action: "start" | "stop" | "restart", server: MCPServer }` — calls the appropriate `mcpClient` method. Used when the user saves/deletes a server in settings.

### Agent integration (`app/api/agent/stream/route.ts`)

The agent stream route receives an additional `mcpServers: MCPServer[]` field in the request body (enabled servers only). At session start, it calls `mcpClient.listTools(id)` for each server and merges the results into the tool registry alongside built-ins. When the model calls a tool not in the built-in set, it is dispatched to `mcpClient.callTool(id, tool, args)`.

MCP tool names are namespaced to avoid collisions: `{serverName}__{toolName}` (double underscore). The agent system prompt is prepended with a note listing available MCP servers and their tool counts.

### Settings UI (`SettingsModal.tsx`)

New "MCP" tab (alongside existing tabs). On mount, fetches `GET /api/mcp` to get server statuses. Contains:
- A list of configured servers. Each row: green dot (connected) or grey dot (disconnected), server name, command (truncated), × delete button.
- An "Add server" button that expands an inline form below the list: Name input + Command input + Save/Cancel.
- Saving posts `{ action: "start", server }` to `/api/mcp` and updates localStorage.
- Deleting posts `{ action: "stop", server }` and removes from localStorage.

---

## Feature 5: Conversation Memory

### Storage

`~/.marven/memory.md` — a plain markdown file on disk. Created on first `remember` call if it doesn't exist.

### `lib/memoryClient.ts` (new file)

Pure Node.js helpers — used directly by API routes:

```ts
const MEMORY_PATH = join(homedir(), ".marven", "memory.md");

export function readMemory(): string {
  return existsSync(MEMORY_PATH) ? readFileSync(MEMORY_PATH, "utf8") : "";
}

export function writeMemory(content: string): void {
  mkdirSync(dirname(MEMORY_PATH), { recursive: true });
  writeFileSync(MEMORY_PATH, content, "utf8");
}
```

A `/api/memory/route.ts` (new file) exposes `GET` (read) and `DELETE` (clear) for the renderer UI.

### `remember` tool

Added to the built-in agent tool registry:

```ts
{
  name: "remember",
  description: "Save information to persistent memory for future sessions. Use for user preferences, project context, or recurring facts.",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "The information to remember" }
    },
    required: ["content"]
  }
}
```

**Execution:** Reads current memory, appends `\n\n- [${new Date().toISOString()}] ${content}`, writes back. Returns `"Remembered."`.

### Injection

In the agent stream route, the request body includes a `memory` string (read by the renderer before sending). If non-empty, it is prepended to the agent system prompt:

```
### Memory
{memory contents}

---
```

### UI

In `AgentWorkspace.tsx`, the agent header shows a 🧠 icon with a line count badge (e.g. `🧠 4`). Hidden when memory is empty. Clicking opens a small popover showing the raw memory markdown, with a "Clear memory" button (calls `memory:write("")`).

---

## Feature 6: Slash Command Templates

### Storage

`PromptTemplate[]` in localStorage under `marven_prompt_templates`. Managed in `app/page.tsx` alongside other settings.

### Settings UI (`SettingsModal.tsx`)

New "Templates" section (in the General tab or its own tab). Each template row shows the trigger and a preview of the prompt text. An "Add template" button expands an inline form: Trigger input (no `/` prefix — added automatically), Label input (optional), Prompt textarea, Save/Cancel.

### Slash menu integration (`SlashMenu.tsx`)

`SLASH_COMMANDS` remains the static built-in list. The `SlashMenu` component receives `promptTemplates: PromptTemplate[]` as a prop. When the menu is open, built-in commands are shown first, then a visual divider (`---`), then user templates. Selecting a template sets the input value to the template's `prompt` text (user can edit before sending) — same behavior as existing slash command selection.

The `onSlashCommand` handler in `InputBar` is extended to handle template triggers by setting the input value directly rather than dispatching a special command.

---

## Files Touched

| File | Change |
|---|---|
| `types/index.ts` | Add `ImageAttachment`, `MCPServer`, `PromptTemplate`; extend `Message.attachments` |
| `app/components/marven/InputBar.tsx` | Paperclip button, paste/drop handlers, attachment preview strip, pass attachments on send |
| `app/components/marven/Message.tsx` | Render image attachments in user bubble (thumbnail left, text right) |
| `app/components/marven/ToolCallCard.tsx` | Expand/collapse state, input + output sections |
| `app/components/marven/SettingsModal.tsx` | MCP tab (server list + add form), Templates section |
| `app/components/marven/AgentWorkspace.tsx` | Memory indicator (🧠 + line count + popover) |
| `app/components/marven/ChatLayout.tsx` | Thread attachments from InputBar → page.tsx; pass MCP servers and memory to agent |
| `app/components/marven/SlashMenu.tsx` | Accept `promptTemplates` prop, render user templates below built-ins |
| `app/page.tsx` | Persist `mcpServers` + `promptTemplates`; read memory; pass to agent/chat |
| `app/api/chat/route.ts` | Multi-part message conversion per provider for vision |
| `app/api/agent/stream/route.ts` | Add `web_search`, `fetch_url`, `remember` tools; merge MCP tools; inject memory |
| `lib/mcpClient.ts` | New singleton: spawn/stop/list/call MCP server child processes via stdio JSON-RPC |
| `lib/memoryClient.ts` | New helpers: `readMemory()` + `writeMemory()` using Node.js `fs` |
| `app/api/mcp/route.ts` | New REST route: start/stop/restart MCP servers + get status |
| `app/api/memory/route.ts` | New REST route: GET (read memory) + DELETE (clear memory) |

---

## Error Handling

- **Image too large:** If base64 exceeds 5MB, show an inline error in the preview strip and block send.
- **Vision provider + non-vision model:** Strip images and append the note. No hard block.
- **web_search timeout / error:** Return the error string as tool output; agent can decide to retry or report.
- **fetch_url non-2xx:** Return `"Error {status}: {statusText}"` as tool output.
- **MCP server crash:** Log the exit code; mark server as disconnected (grey dot); tools from that server are removed from the registry. Agent is notified via a system message if a server it was using disconnects mid-session.
- **MCP tool call timeout:** 30-second timeout per call; returns an error string to the agent.
- **Memory file unreadable:** Treat as empty, do not crash. Agent proceeds without memory context.

---

## Testing

- Attach an image via each entry point (button, paste, drag) → verify preview strip and thumbnail in bubble.
- Send an image to OpenAI → verify multi-part format in network tab; send to Ollama → verify stripped with note.
- Agent uses `web_search` → verify DuckDuckGo response parsed and returned.
- Agent uses `fetch_url` → verify HTML stripped, text truncated at 8000 chars.
- Click a tool card → verify expand/collapse; verify full args and output visible.
- Add an MCP server in settings → verify green dot appears; agent session lists MCP tools; agent can call one.
- Agent calls `remember` → verify appended to `~/.marven/memory.md`; next session shows memory in system prompt.
- Add a prompt template `/review` → verify it appears in slash menu; selecting it fills the input.
