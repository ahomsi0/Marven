// Renderer-side client for the codebase indexer API routes.
//
// Mirrors the legacy `window.marvenElectron.index.*` IPC surface so existing
// callers (SettingsModal, app/page.tsx) need only a small wiring change. All
// methods talk to the Next.js routes under /api/index/*; the server holds the
// singleton indexer / sqlite store.

import type { IndexProgress, IndexStats, SearchResult } from "@/types";

export interface IndexStatus {
  enabled: boolean;
  running: boolean;
  workspaceRoot: string | null;
  progress: IndexProgress | null;
  stats: IndexStats | null;
  lastError: string | null;
}

export async function status(workspaceRoot?: string | null): Promise<IndexStatus> {
  const qs = workspaceRoot ? `?workspaceRoot=${encodeURIComponent(workspaceRoot)}` : "";
  const r = await fetch(`/api/index/status${qs}`);
  if (!r.ok) throw new Error(`status failed: ${r.status}`);
  return (await r.json()) as IndexStatus;
}

// Kick off a full reindex and return immediately. Use `subscribe` for progress
// events, or poll `status` if you only need the current state.
export async function runFull(workspaceRoot: string): Promise<void> {
  await fetch(`/api/index/run-full`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceRoot, stream: false }),
  });
}

// Open an SSE stream for a (currently running or freshly-started) reindex.
// Returns an unsubscribe function that closes the stream.
export interface RunFullCallbacks {
  onProgress?: (p: IndexProgress) => void;
  onDone?: (r: { filesIndexed: number; chunksIndexed: number; durationMs: number }) => void;
  onError?: (e: { message: string }) => void;
}
export function runFullStream(
  workspaceRoot: string,
  cb: RunFullCallbacks,
): () => void {
  const ctrl = new AbortController();
  (async () => {
    let res: Response;
    try {
      res = await fetch(`/api/index/run-full`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot }),
        signal: ctrl.signal,
      });
    } catch {
      return;
    }
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        // Parse a single SSE frame: `event: <name>\ndata: <json>`.
        let event = "message";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7).trim();
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (!data) continue;
        try {
          const json = JSON.parse(data);
          if (event === "progress") cb.onProgress?.(json);
          else if (event === "done") cb.onDone?.(json);
          else if (event === "error") cb.onError?.(json);
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  })();
  return () => ctrl.abort();
}

export async function search(
  workspaceRoot: string,
  query: string,
  limit?: number,
): Promise<SearchResult[] | { error: string }> {
  const r = await fetch(`/api/index/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceRoot, query, limit }),
  });
  if (!r.ok) {
    try {
      return (await r.json()) as { error: string };
    } catch {
      return { error: `search failed: ${r.status}` };
    }
  }
  return (await r.json()) as SearchResult[];
}

export async function cancel(): Promise<void> {
  await fetch(`/api/index/cancel`, { method: "POST" });
}

export async function clear(workspaceRoot: string): Promise<void> {
  await fetch(`/api/index/clear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceRoot }),
  });
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await fetch(`/api/index/set-enabled`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export async function updateFile(workspaceRoot: string, path: string): Promise<void> {
  await fetch(`/api/index/update-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceRoot, path }),
  });
}

export async function deleteFile(workspaceRoot: string, path: string): Promise<void> {
  await fetch(`/api/index/delete-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceRoot, path }),
  });
}

// Convenience: kick off a reindex on workspace open. Fire-and-forget — we
// stream progress in the background so the SettingsModal status indicator
// reflects activity, but callers don't need to await.
export function setWorkspace(workspaceRoot: string): void {
  // Just kick off a non-streaming run. The status endpoint can be polled.
  void runFull(workspaceRoot);
}
