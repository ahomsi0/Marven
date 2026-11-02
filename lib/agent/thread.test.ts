import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@/types";
import { cancelInFlightToolCalls, SWITCH_CANCEL_NOTE } from "./thread";

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
