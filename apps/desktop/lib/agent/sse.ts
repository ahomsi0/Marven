// Reads the Agent's server-sent events (POST /api/agent/stream). Shared by the
// main window's Agent (hooks/useAgentStream.ts) and Mini Me's builds.

import type { AgentEvent } from "@/types";

/** Complete `event:`/`data:` frames in `buf` as events, plus the unfinished tail to keep. */
export function parseSseBuffer(buf: string): { events: AgentEvent[]; rest: string } {
  const parts = buf.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: AgentEvent[] = [];
  for (const part of parts) {
    const lines = part.trim().split("\n");
    let eventType = "";
    let dataLine = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) eventType = line.slice(7);
      if (line.startsWith("data: ")) dataLine = line.slice(6);
    }
    if (!eventType || !dataLine) continue;
    try {
      events.push(JSON.parse(dataLine));
    } catch {
      // A malformed frame is skipped, as before.
    }
  }
  return { events, rest };
}

/** Feeds every event of the response to `onEvent`, in order, awaiting each. */
export async function consumeSse(
  res: Response,
  onEvent: (event: AgentEvent) => void | Promise<void>,
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const dec = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const { events, rest } = parseSseBuffer(buf);
    buf = rest;
    for (const event of events) await onEvent(event);
  }
}
