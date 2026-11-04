import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, BrowserResult } from "@/types";
import { relayBrowserAction } from "./useAgentStream";

type BrowserActionEvent = Extract<AgentEvent, { type: "browser_action" }>;

const event = {
  type: "browser_action",
  callId: "c1",
  runId: "r1",
  action: { tool: "browser_read", args: {}, approvedHosts: [], approvedSubmit: false, canSeeImages: false },
} as BrowserActionEvent;

function bridge(run: () => Promise<BrowserResult>) {
  vi.stubGlobal("window", { marvenElectron: { browser: { agent: { run } } } });
}

function postedResults(fetchMock: ReturnType<typeof vi.fn>): BrowserResult[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).result);
}

describe("relayBrowserAction", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    bridge(async () => ({ kind: "ok", text: "page" }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts the result once when the server accepts it", async () => {
    fetchMock.mockResolvedValue({ status: 200 });
    await relayBrowserAction(event, "conv");
    expect(postedResults(fetchMock)).toEqual([{ kind: "ok", text: "page" }]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ callId: "c1", runId: "r1" });
  });

  it("answers with an error when the server rejects the result (400)", async () => {
    fetchMock.mockResolvedValueOnce({ status: 400 }).mockResolvedValueOnce({ status: 200 });
    await relayBrowserAction(event, "conv");
    const posted = postedResults(fetchMock);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toEqual({ kind: "error", text: "The browser's answer couldn't be delivered. Read the page again." });
  });

  it("answers with an error when the request fails outright", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ status: 200 });
    await relayBrowserAction(event, "conv");
    expect(postedResults(fetchMock)).toHaveLength(2);
  });

  it("stays silent on a 404 (the run was stopped)", async () => {
    fetchMock.mockResolvedValue({ status: 404 });
    await relayBrowserAction(event, "conv");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("only retries once, and never throws", async () => {
    fetchMock.mockResolvedValue({ status: 400 });
    await expect(relayBrowserAction(event, "conv")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a throwing bridge as an error result", async () => {
    bridge(async () => { throw new Error("boom"); });
    fetchMock.mockResolvedValue({ status: 200 });
    await relayBrowserAction(event, "conv");
    expect(postedResults(fetchMock)[0]).toEqual({ kind: "error", text: "The browser action failed: boom" });
  });
});
