# Marven Agent Refactor — Design Spec
_2026-05-13_

## Overview

Refactor Marven from a basic file-editing agent into a full tool-use loop agent (comparable to Claude Code / Codex), while keeping the existing Chat mode and all macOS assistant features completely untouched.

---

## Design Decisions

| Decision | Choice |
|---|---|
| AI providers | Groq + Ollama, independently — no silent fallbacks |
| Tool calling | Native function calling on both; if Ollama model rejects it, surface clear "not supported" error with compatible model suggestions |
| Agent loop | Server-side, streaming via SSE, max 20 iterations |
| Workspace | Open any folder (VS Code-style folder picker) |
| Layout | Layout B — agent stream left, editor + terminal right |
| Visual theme | Obsidian + Sand (`#0a0a0a` base, `#d19a66` accent) |
| Streaming | Live — user watches each tool call as it happens |
| Chat mode | Untouched |

---

## Architecture

### Layer 1 — Tools (`lib/agent/tools.ts`)

Five tools, each sandboxed to the open workspace folder:

| Tool | Args | Description |
|---|---|---|
| `list_files` | `path?` | List files/dirs in workspace or subdirectory |
| `read_file` | `path` | Return full file contents |
| `write_file` | `path, content` | Write/overwrite file, create dirs if needed |
| `run_command` | `command, cwd?` | Run shell command inside workspace |
| `search_files` | `query, path?` | Grep for a string across workspace files |

Safety: `run_command` rejects patterns containing `sudo`, absolute paths outside workspace, and `rm -rf /` variants. Rejection surfaces as a tool result the AI sees.

### Layer 2 — Agent Loop (`lib/agent/loop.ts`)

```
1. Receive prompt + workspace root + message history
2. Build messages: [system, ...history, user]
3. Send to AI with tool schemas
4. AI responds:
   ├─ tool_call  → execute → append result → goto 3
   └─ text       → stream final reply → done
5. Max 20 iterations
6. Ollama "tools not supported" → emit error event with model suggestions
```

Provider adapters:
- `lib/agent/groq.ts` — uses Groq's `tools` + `tool_choice` fields
- `lib/agent/ollama.ts` — uses Ollama `/api/chat` `tools` field; detects unsupported models

### Layer 3 — Streaming (`app/api/agent/stream/route.ts`)

SSE endpoint. Event types:

```
tool_call    { tool, args, callId }
tool_result  { callId, output, truncated }
text_delta   { delta }
done         { toolCallCount }
error        { code, message, suggestions? }
```

Error codes: `tools_not_supported`, `command_blocked`, `max_iterations`, `workspace_not_set`.

---

## UI Components

### New components
- `WorkspaceBar` — folder path display + "Open Folder" button + model/provider pill
- `AgentPanel` — left panel: conversation history + live tool call stream + input bar
- `ToolCallCard` — single tool call with three states: pending → running → done/error
- `EditorPanel` — right panel: file tabs + code editor (textarea, syntax via CSS) + terminal view
- `TerminalView` — mini terminal showing `run_command` output

### Rewritten
- `AgentWorkspace` — composes `AgentPanel` + `EditorPanel`, replaces current implementation

### New hooks
- `useAgentStream` — subscribes to SSE endpoint, dispatches events into local state

### New API routes
- `POST /api/agent/stream` — SSE streaming agent loop
- `GET /api/workspace/open` — triggers Electron folder picker dialog (falls back to path input in browser)

---

## Visual Theme — Obsidian + Sand

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#0a0a0a` | App background |
| `--bg-panel` | `#0d0d0d` | Panel backgrounds |
| `--bg-elevated` | `#111111` | Cards, inputs |
| `--border` | `#1a1a1a` | All borders |
| `--border-active` | `#2a2a2a` | Focused/hover borders |
| `--text` | `#cccccc` | Primary text |
| `--text-muted` | `#444444` | Secondary/label text |
| `--accent` | `#d19a66` | Active states, highlights, cursor |
| `--accent-dim` | `rgba(209,154,102,0.08)` | Active card backgrounds |

---

## File Structure

**Untouched** — all chat mode components, all existing API routes except `/api/agent`, all lib files except those in `lib/agent/`.

**Rewritten:**
- `app/components/marven/AgentWorkspace.tsx`
- `app/api/agent/route.ts` → superseded by `app/api/agent/stream/route.ts`
- `app/api/workspace/files/route.ts` — extend with folder-open support
- `types/index.ts` — add `AgentEvent`, `Tool`, `ToolCall` types
- `app/page.tsx` — wire up new stream hook

**Added:**
- `lib/agent/tools.ts`
- `lib/agent/loop.ts`
- `lib/agent/groq.ts`
- `lib/agent/ollama.ts`
- `app/api/agent/stream/route.ts`
- `app/components/marven/AgentPanel.tsx`
- `app/components/marven/ToolCallCard.tsx`
- `app/components/marven/EditorPanel.tsx`
- `app/components/marven/WorkspaceBar.tsx`
- `hooks/useAgentStream.ts`
