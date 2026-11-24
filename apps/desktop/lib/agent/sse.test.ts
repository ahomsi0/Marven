import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/types";
import { consumeSse, parseSseBuffer } from "./sse";

function responseFrom(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body);
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("parseSseBuffer", () => {
  it("returns complete events and keeps the unfinished tail", () => {
    const buf = frame("done", { type: "done", toolCallCount: 1 }) + "event: text_delta\ndata: {\"ty";
    const { events, rest } = parseSseBuffer(buf);
    expect(events).toEqual([{ type: "done", toolCallCount: 1 }]);
    expect(rest).toBe("event: text_delta\ndata: {\"ty");
  });

  it("skips frames without an event or data line, and bad JSON", () => {
    const buf = "data: {}\n\n" + "event: x\n\n" + "event: x\ndata: {nope\n\n" + frame("done", { type: "done", toolCallCount: 0 });
    expect(parseSseBuffer(buf).events).toEqual([{ type: "done", toolCallCount: 0 }]);
  });
});

describe("consumeSse", () => {
  it("delivers events split across chunks, in order", async () => {
    const all =
      frame("tool_call", { type: "tool_call", callId: "c1", tool: "write_file", args: { path: "a.html" } }) +
      frame("text_delta", { type: "text_delta", delta: "Done." }) +
      frame("done", { type: "done", toolCallCount: 1 });
    const chunks = [all.slice(0, 10), all.slice(10, 57), all.slice(57, 120), all.slice(120)];
    const seen: AgentEvent[] = [];
    await consumeSse(responseFrom(chunks), (e) => {
      seen.push(e);
    });
    expect(seen.map((e) => e.type)).toEqual(["tool_call", "text_delta", "done"]);
  });

  it("awaits async handlers before the next event", async () => {
    const order: string[] = [];
    await consumeSse(responseFrom([frame("a", { type: "done", toolCallCount: 1 }) + frame("b", { type: "done", toolCallCount: 2 })]), async (e) => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(String((e as { toolCallCount: number }).toolCallCount));
    });
    expect(order).toEqual(["1", "2"]);
  });

  it("throws when there is no body", async () => {
    await expect(consumeSse(new Response(null), () => {})).rejects.toThrow("No response body");
  });
});
