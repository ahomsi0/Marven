import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { NextRequest } from "next/server";
import { POST } from "./route";

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

async function readSse(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const lines = part.trim().split("\n");
      const event = lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "";
      const dataLine = lines.find((l) => l.startsWith("data: "))?.slice(6) ?? "{}";
      events.push({ event, data: JSON.parse(dataLine) as Record<string, unknown> });
    }
  }

  return events;
}

describe("POST /api/agent/verify", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "marven-verify-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("streams an explicit verification command and a passing summary", async () => {
    const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write('verify ok')"`;
    const res = await POST(makeReq({
      workspaceRoot: tmpRoot,
      commands: [command],
    }));

    expect(res.status).toBe(200);
    const events = await readSse(res.body!);
    expect(events.some((e) => e.event === "tool_call")).toBe(true);
    expect(events.some((e) => e.event === "tool_result" && String(e.data.output).includes("verify ok"))).toBe(true);
    expect(events.some((e) => e.event === "text_delta" && String(e.data.delta).includes("Auto-verify passed"))).toBe(true);
  });

  it("skips verification when no commands are configured or detected", async () => {
    const res = await POST(makeReq({
      workspaceRoot: tmpRoot,
      commands: [],
    }));

    expect(res.status).toBe(200);
    const events = await readSse(res.body!);
    expect(events.some((e) => e.event === "tool_call")).toBe(false);
    expect(events.some((e) => e.event === "text_delta" && String(e.data.delta).includes("Auto-verify skipped"))).toBe(true);
  });
});
