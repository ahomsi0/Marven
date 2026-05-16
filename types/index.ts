export type MessageRole = "user" | "assistant";
export type AIProvider = "groq" | "ollama" | "nim" | "openrouter" | "openai" | "anthropic";
export type ConversationMode = "chat" | "agent";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface OllamaModel {
  name: string;
  // size in bytes, returned by Ollama's /api/tags
  size: number;
}

/** A single turn in the conversation history sent to the AI */
export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
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
}

// ─── Agent tool-use loop types ────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: "string" | "number" | "boolean" | "array" | "object"; description: string }>;
    required: string[];
  };
}

/** A message inside the running tool-use loop (not the same as HistoryMessage) */
export type InternalMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "assistant_tool_call"; callId: string; tool: string; args: Record<string, unknown> }
  | { role: "tool_result"; callId: string; content: string };

export type AgentEventType = "tool_call" | "tool_result" | "text_delta" | "done" | "error";

export type AgentEvent =
  | { type: "tool_call"; callId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; callId: string; output: string; truncated: boolean }
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
}

/** Per-tool-call UI state rendered by ToolCallCard */
export interface ToolCallState {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "done" | "error";
  output?: string;
}
