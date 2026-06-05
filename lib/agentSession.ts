/**
 * Persist agent-mode thread + editor state per conversation so restarts
 * don't wipe the tool-use transcript, open tabs, or in-memory buffers.
 */
import type { AgentMessage, EditorTab } from "@/types";

const STORAGE_KEY = "marven_agent_sessions_v1";

export interface SerializedBufferEntry {
  path: string;
  content: string;
  dirty: boolean;
}

export interface PersistedAgentSession {
  messages: AgentMessage[];
  openTabs: EditorTab[];
  activeTabIndex: number;
  buffers: SerializedBufferEntry[];
  savedAt: string;
}

export type AgentSessionsFile = Record<string, PersistedAgentSession>;

function emptySessions(): AgentSessionsFile {
  return {};
}

export function loadAgentSessionsFile(): AgentSessionsFile {
  if (typeof window === "undefined") return emptySessions();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySessions();
    const parsed = JSON.parse(raw) as AgentSessionsFile;
    return parsed && typeof parsed === "object" ? parsed : emptySessions();
  } catch {
    return emptySessions();
  }
}

export function saveAgentSessionsFile(data: AgentSessionsFile): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Quota — best effort: drop largest buffer contents and retry once
    try {
      const slim: AgentSessionsFile = {};
      for (const [id, s] of Object.entries(data)) {
        slim[id] = {
          ...s,
          buffers: s.buffers.map((b) =>
            b.content.length > 120_000
              ? { ...b, content: b.content.slice(0, 120_000) + "\n/* …truncated for storage … */" }
              : b,
          ),
        };
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch {
      /* ignore */
    }
  }
}

export function buffersToEntries(
  m: Map<string, { content: string; dirty: boolean; loading: boolean }>,
): SerializedBufferEntry[] {
  const out: SerializedBufferEntry[] = [];
  for (const [path, v] of m.entries()) {
    out.push({ path, content: v.content, dirty: v.dirty });
  }
  return out;
}

export function entriesToBuffers(
  entries: SerializedBufferEntry[],
): Map<string, { content: string; dirty: boolean; loading: boolean }> {
  const next = new Map<string, { content: string; dirty: boolean; loading: boolean }>();
  for (const e of entries) {
    next.set(e.path, { content: e.content, dirty: e.dirty, loading: false });
  }
  return next;
}

export function upsertPersistedSession(
  file: AgentSessionsFile,
  conversationId: string,
  session: Omit<PersistedAgentSession, "savedAt">,
): AgentSessionsFile {
  return {
    ...file,
    [conversationId]: {
      ...session,
      savedAt: new Date().toISOString(),
    },
  };
}

export function removePersistedSession(
  file: AgentSessionsFile,
  conversationId: string,
): AgentSessionsFile {
  const next = { ...file };
  delete next[conversationId];
  return next;
}
