import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { start, stop } = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  stop: vi.fn(),
}));

vi.mock("@/lib/mcpClient", () => ({
  mcpClient: { start, stop, getStatus: () => ({}) },
}));

import { POST } from "./route";

function makeReq(body: unknown): NextRequest {
  return {
    url: "http://localhost:47891/api/mcp",
    headers: new Headers(),
    json: async () => body,
  } as unknown as NextRequest;
}

const server = { id: "s1", name: "fs", command: "echo hi", enabled: true };

describe("POST /api/mcp trust requirement", () => {
  beforeEach(() => {
    start.mockClear();
    stop.mockClear();
  });

  it.each(["start", "restart"])("refuses to %s a server without trusted at all", async (action) => {
    const res = await POST(makeReq({ action, server }));
    expect(res.status).toBe(403);
    expect(start).not.toHaveBeenCalled();
  });

  it("refuses to start a server marked untrusted", async () => {
    const res = await POST(makeReq({ action: "start", server: { ...server, trusted: false } }));
    expect(res.status).toBe(403);
    expect(start).not.toHaveBeenCalled();
  });

  it("refuses a truthy non-boolean trusted value", async () => {
    const res = await POST(makeReq({ action: "start", server: { ...server, trusted: "yes" } }));
    expect(res.status).toBe(403);
    expect(start).not.toHaveBeenCalled();
  });

  it("starts a server explicitly marked trusted", async () => {
    const res = await POST(makeReq({ action: "start", server: { ...server, trusted: true } }));
    expect(res.status).toBe(200);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("still lets an untrusted server be stopped", async () => {
    const res = await POST(makeReq({ action: "stop", server }));
    expect(res.status).toBe(200);
    expect(stop).toHaveBeenCalledWith("s1");
  });
});
