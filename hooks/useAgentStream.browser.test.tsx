// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/types";
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
