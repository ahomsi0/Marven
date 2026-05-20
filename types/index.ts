export type MessageRole = "user" | "assistant";
export type AIProvider = "groq" | "ollama" | "nim" | "openrouter" | "openai" | "anthropic";
export type ConversationMode = "chat" | "agent";

export interface DocAttachment {
  name: string;
  text: string;      // extracted full text
  mimeType: string;  // "application/pdf" or docx MIME
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  attachments?: ImageAttachment[];
  docs?: DocAttachment[];
}

export interface ImageAttachment {
  base64: string;     // full data URL e.g. "data:image/png;base64,..."
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  name: string;       // original filename e.g. "screenshot.png"
}

export interface MCPServer {
  id: string;         // uuid generated on creation
  name: string;       // user label e.g. "filesystem"
  command: string;    // full shell command e.g. "npx @modelcontextprotocol/server-filesystem ~/"
  enabled: boolean;
}

export interface PromptTemplate {
  id: string;
  trigger: string;    // slash keyword e.g. "review" → accessible as /review
  prompt: string;     // text that fills the input on selection
  label?: string;     // display name in slash menu (falls back to trigger)
}

export interface OllamaModel {
  name: string;
  // size in bytes, returned by Ollama's /api/tags
  size: number;
}

/** A single turn in the conversation history sent to the AI */
export interface HistoryMessage {
  role: MessageRole;
  content: string;
  attachments?: ImageAttachment[];
  docs?: DocAttachment[];
}

export interface ChatRequest {
  messages: HistoryMessage[];
  model: string;
  provider?: AIProvider;
  systemPrompt?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  reply: string;
  commandExecuted?: boolean;
  usage?: TokenUsage;
}

export interface WorkspaceFile {
  path: string;
  name: string;
  type?: "file" | "folder";
}

export interface AgentWriteFile {
  path: string;
  content: string;
  summary?: string;
}

export interface AgentResponse {
  reply: string;
  files: AgentWriteFile[];
  inspectedFiles?: string[];
}

export interface ParsedCommand {
  type:
    | "open-website"
    | "open-app"
    | "google-search"
    | "get-time"
    | "get-date"
    | "take-screenshot"
    | "lock-screen"
    | "open-downloads"
    | "empty-trash"
    | "volume-up"
    | "volume-down"
    | "volume-mute"
    | "volume-unmute"
    | "set-volume"
    | "media-play-pause"
    | "media-next"
    | "media-previous"
    | "media-what-playing"
    | "get-weather"
    | "get-battery"
    | "remember"
    | null;
  payload: string;
}

export interface CustomShortcut {
  trigger: string;
  url: string;
  label?: string;
}

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
  workspaceRoot?: string;   // agent mode: which folder is open in this conversation
  folderId?: string | null; // user-defined grouping label; null/undefined = no folder
}

export interface ConversationFolder {
  id: string;
  name: string;
  createdAt: string;
}

// ─── Agent tool-use loop types ────────────────────────────────────────────────

// JSON-Schema-shaped property definition. Loose intentionally — providers
// accept any subset of JSON Schema in their function-call descriptors and
// we want to be able to describe nested objects/arrays for tools like
// apply_patch without inventing a brand-new type system.
export interface ToolPropertyDef {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  items?: ToolPropertyDef | { type: "object"; properties: Record<string, ToolPropertyDef>; required?: string[] };
  properties?: Record<string, ToolPropertyDef>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolPropertyDef>;
    required: string[];
  };
}

/** A message inside the running tool-use loop (not the same as HistoryMessage) */
export type InternalMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string; attachments?: ImageAttachment[] }
  | { role: "assistant"; content: string }
  | { role: "assistant_tool_call"; callId: string; tool: string; args: Record<string, unknown> }
  | { role: "tool_result"; callId: string; content: string };

export type AgentEventType =
  | "tool_call"
  | "tool_result"
  | "tool_progress"
  | "pending_approval"
  | "checkpoint"
  | "text_delta"
  | "done"
  | "error";

export type AgentEvent =
  | { type: "tool_call"; callId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; callId: string; output: string; truncated: boolean }
  | { type: "tool_progress"; callId: string; chunk: string }
  | { type: "pending_approval"; callId: string; tool: string; args: Record<string, unknown>; preview?: WritePreview }
  | { type: "checkpoint"; path: string }
  | { type: "text_delta"; delta: string }
  | { type: "done"; toolCallCount: number }
  | { type: "error"; code: string; message: string; suggestions?: string[] };

export interface WorkspaceSession {
  root: string;
  name: string;
}

/** A message in the agent conversation panel */
export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallState[];
  attachments?: ImageAttachment[];
  isSummary?: true;
}

/** Per-tool-call UI state rendered by ToolCallCard */
export interface ToolCallState {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "awaiting_approval" | "done" | "error" | "rejected";
  output?: string;
  liveOutput?: string;
  preview?: WritePreview;
}

export interface DiffEntry {
  path: string;
  before: string | null;
  after: string | null;
}

export interface WritePreview {
  path: string;
  before: string;
  after: string;
  diff: string; // unified diff string produced by createPatch()
}

export type EditorTab =
  | { kind: "file"; path: string }
  | { kind: "settings" }
  | { kind: "preview"; url: string }
  | { kind: "rest"; requestId: string };

export interface RestHeader {
  key: string;
  value: string;
  enabled: boolean;
}

export type RestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface RestRequest {
  id: string;
  name: string;
  method: RestMethod;
  url: string;
  headers: RestHeader[];
  body: string;
  bodyType: "none" | "json" | "text" | "form";
  savedAt?: string; // ISO string
}

export interface RestCollection {
  id: string;
  name: string;
  requests: RestRequest[];
}
