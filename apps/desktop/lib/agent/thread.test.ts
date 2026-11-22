import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@/types";
import {
  buildWireHistory,
  cancelInFlightToolCalls,
  condenseWindow,
  KEEP_RECENT,
  SUMMARIZE_THRESHOLD,
  SWITCH_CANCEL_NOTE,
} from "./thread";

function thread(n: number, prefix = "m"): AgentMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `${prefix} ${i}`,
  }));
}

describe("condenseWindow", () => {
  it("returns null at or below the threshold", () => {
    expect(condenseWindow(thread(SUMMARIZE_THRESHOLD))).toBeNull();
  });

  it("keeps the last KEEP_RECENT messages and summarizes the rest", () => {
    const t = thread(SUMMARIZE_THRESHOLD + 5);
    const w = condenseWindow(t)!;
    expect(w.recentMessages).toEqual(t.slice(-KEEP_RECENT));
    expect(w.oldMessages).toEqual(t.slice(0, t.length - KEEP_RECENT));
  });

  it("only ever sees the (truncated) base it is given — removed turns can't come back", () => {
    const full = thread(40);
    const truncated = full.slice(0, 33); // user edited message #33
    const turn = [
      { id: "u-new", role: "user" as const, content: "edited" },
      { id: "a-new", role: "assistant" as const, content: "" },
    ];
    const w = condenseWindow([...truncated, ...turn])!;
    const ids = [...w.oldMessages, ...w.recentMessages].map((m) => m.id);
    for (const removed of full.slice(33)) expect(ids).not.toContain(removed.id);
    expect(ids.slice(-2)).toEqual(["u-new", "a-new"]);
  });
});

describe("buildWireHistory", () => {
  it("drops the current turn pair and summarizes tool-only assistant turns", () => {
    const msgs: AgentMessage[] = [
      { id: "1", role: "user", content: "first" },
      { id: "2", role: "assistant", content: "", toolCalls: [{ callId: "c", tool: "read_file", args: {}, status: "done" }] },
      { id: "3", role: "assistant", content: "" },
      { id: "4", role: "user", content: "now" },
      { id: "5", role: "assistant", content: "" },
    ];
    expect(buildWireHistory(msgs)).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "[Used tools: read_file]" },
    ]);
  });
});

const NOTE = "Cancelled.";

describe("cancelInFlightToolCalls", () => {
  it("marks running, pending and awaiting-approval calls as errored with a note", () => {
    const msgs: AgentMessage[] = [
      { id: "u1", role: "user", content: "go" },
      {
        id: "a1",
        role: "assistant",
        content: "working",
        toolCalls: [
          { callId: "1", tool: "read_file", args: {}, status: "done", output: "ok" },
          { callId: "2", tool: "run_command", args: {}, status: "running", liveOutput: "line 1\n" },
          { callId: "3", tool: "write_file", args: {}, status: "awaiting_approval" },
          { callId: "4", tool: "list_files", args: {}, status: "pending" },
        ],
      },
    ];
    const out = cancelInFlightToolCalls(msgs, NOTE);
    const calls = out[1].toolCalls!;
    expect(calls[0]).toEqual(msgs[1].toolCalls![0]);
    expect(calls[1]).toMatchObject({ status: "error", output: `line 1\n\n${NOTE}` });
    expect(calls[2]).toMatchObject({ status: "error", output: NOTE });
    expect(calls[3]).toMatchObject({ status: "error", output: NOTE });
    // Untouched messages keep their identity; input isn't mutated.
    expect(out[0]).toBe(msgs[0]);
    expect(msgs[1].toolCalls![1].status).toBe("running");
  });

  it("leaves client-side plan approvals alone", () => {
    const msgs: AgentMessage[] = [{
      id: "a", role: "assistant", content: "",
      toolCalls: [{ callId: "p", tool: "__plan__", args: {}, status: "awaiting_approval" }],
    }];
    expect(cancelInFlightToolCalls(msgs, NOTE)).toBe(msgs);
  });

  it("returns the same array when nothing is in flight", () => {
    const msgs: AgentMessage[] = [{ id: "a", role: "assistant", content: "hi", toolCalls: [] }];
    expect(cancelInFlightToolCalls(msgs, SWITCH_CANCEL_NOTE)).toBe(msgs);
  });
});
