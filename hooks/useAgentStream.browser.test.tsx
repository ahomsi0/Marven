// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/types";
import { isBrowserApprovalWaiting, onBrowserApprovalWaiting } from "@/lib/browserApprovalWait";
import { useAgentStream } from "./useAgentStream";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sse = (events: AgentEvent[]) =>
  new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { status: 200 });

const browserAction: AgentEvent = {
  type: "browser_action",
  callId: "b1",
  runId: "run1",
  action: { tool: "browser_read", args: { tab: "t1" }, approvedHosts: [], approvedSubmit: false, canSeeImages: false },
};

describe("useAgentStream with the browser", () => {
  let root: Root;
  let log: string[];
  let agent: { run: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn>; takeOver: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    log = [];
    localStorage.setItem("agentBrowsing", "true");
    agent = {
      run: vi.fn(async () => ({ kind: "ok", text: "page" })),
      resume: vi.fn(),
      takeOver: vi.fn(),
      end: vi.fn((runId: string) => { log.push(`end ${runId}`); }),
    };
    (window as unknown as { marvenElectron: unknown }).marvenElectron = { browser: { agent } };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      log.push(`fetch ${url}`);
      if (url === "/api/agent/stream") {
        return sse([
          browserAction,
          { type: "tool_call", callId: "w1", tool: "write_file", args: { path: "a.txt", content: "x" } },
          { type: "tool_result", callId: "w1", output: "ok", truncated: false },
        ]);
      }
      if (url === "/api/agent/verify") return sse([]);
      return new Response("{}", { status: 200 });
    }));
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    localStorage.clear();
    delete (window as unknown as { marvenElectron?: unknown }).marvenElectron;
  });

  it("tells the agent strip while a browser approval waits for the user", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/agent/stream"
      ? sse([
        browserAction,
        { type: "pending_approval", callId: "b1", tool: "browser_click", args: { tab: "t1", ref: 1 }, browser: { kind: "site", host: "shop.test", action: "click", target: "Buy" } },
        { ...browserAction, callId: "b1:1" } as AgentEvent,
        { type: "tool_result", callId: "b1", output: "Clicked", truncated: false },
        { type: "pending_approval", callId: "b2", tool: "browser_click", args: { tab: "t1", ref: 2 }, browser: { kind: "submit", host: "shop.test", action: "click", target: "Pay" } },
      ])
      : new Response("{}", { status: 200 }))));
    const seen: boolean[] = [];
    const off = onBrowserApprovalWaiting(() => seen.push(isBrowserApprovalWaiting()));
    let send: ((prompt: string) => Promise<void>) | null = null;
    function Harness() {
      send = useAgentStream({ provider: "groq", model: "m", workspaceRoot: "/tmp/ws", conversationId: "c1" }).send;
      return null;
    }
    await act(async () => root.render(createElement(Harness)));
    await act(async () => { await send!("go"); });
    off();
    // Waiting, answered (the action went out again), waiting again, and the stream's end clears it.
    expect(seen).toEqual([true, false, true, false]);
    expect(isBrowserApprovalWaiting()).toBe(false);
  });

  it("ends the browser run as soon as the agent stream finishes, before auto-verify", async () => {
    let send: ((prompt: string) => Promise<void>) | null = null;
    function Harness() {
      send = useAgentStream({
        provider: "groq", model: "m", workspaceRoot: "/tmp/ws", conversationId: "c1", autoVerifyEnabled: true, autoVerifyCommands: "npm test",
      }).send;
      return null;
    }
    await act(async () => root.render(createElement(Harness)));
    await act(async () => { await send!("go"); });
    expect(log).toContain("fetch /api/agent/verify");
    expect(agent.end).toHaveBeenCalledTimes(1);
    expect(log.indexOf("end run1")).toBeLessThan(log.indexOf("fetch /api/agent/verify"));
  });
});
