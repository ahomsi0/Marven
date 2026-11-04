// electron/browser/agent.test.ts
import { describe, expect, it, vi } from "vitest";
import { createAgentController } from "./agent.js";

type Req = { op: string; [k: string]: unknown };

const element = (over: Record<string, unknown> = {}) => ({
  ref: 1, role: "button", name: "Buy", value: "", checked: false, disabled: false, inViewport: true,
  editable: false, sensitive: false, file: false, submits: false, ...over,
});

function setup(page: (req: Req) => unknown = () => null) {
  let clock = 0;
  const tabs = new Map<string, Record<string, unknown>>();
  const makeTab = (id: string, conversationId: string | null, url = "https://shop.test/") => {
    const tab = {
      id, url, title: "Shop", navigation: 1, loading: false, error: null, auth: null as null | { host: string },
      agent: conversationId ? { conversationId } : null,
      ensureView: vi.fn(), load: vi.fn(), command: vi.fn(),
    };
    tabs.set(id, tab);
    return tab;
  };
  const deps = {
    tabs: {
      get: (id: string) => tabs.get(id) ?? null,
      open: vi.fn((conversationId: string, url: string) => makeTab(`t${tabs.size + 1}`, conversationId, url)),
      owned: (conversationId: string) => [...tabs.values()].filter((t) => (t.agent as { conversationId: string } | null)?.conversationId === conversationId),
      activate: vi.fn(),
      close: vi.fn((id: string) => tabs.delete(id)),
    },
    isShown: () => true,
    onChange: vi.fn(),
    runInPage: vi.fn(async (_tab: unknown, req: object) => page(req as Req)),
    sendInput: vi.fn(),
    insertText: vi.fn(),
    capture: vi.fn(async () => ({ base64: "data:image/jpeg;base64,AA", mimeType: "image/jpeg", name: "screenshot.jpg" })),
    sleep: vi.fn(async (ms: number) => { clock += ms; }),
    now: () => clock,
  };
  const agent = createAgentController(deps);
  return { agent, deps, tabs, makeTab };
}

const act = (tool: string, args: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  ({ tool, args, approvedHosts: [], approvedSubmit: false, canSeeImages: false, ...over });

const readResult = (elements = [element()]) => ({
  url: "https://shop.test/", title: "Shop", text: "Hello shop", elements, totalElements: elements.length,
  scrollY: 0, scrollHeight: 1000, viewportHeight: 800,
});

const targetResult = (info = element(), over: Record<string, unknown> = {}) =>
  ({ info, x: 50, y: 20, covered: "", entersSubmit: false, fields: [], ...over });

describe("agent controller", () => {
  it("opens agent tabs owned by the conversation, ten at most", async () => {
    const { agent, deps } = setup();
    const result = await agent.perform("run1", "conv1", act("browser_open", { url: "https://shop.test/" }));
    expect(result).toMatchObject({ kind: "ok", text: expect.stringContaining("[tab t1]") });
    for (let i = 0; i < 9; i++) await agent.perform("run1", "conv1", act("browser_open", { url: "https://shop.test/" }));
    expect(await agent.perform("run1", "conv1", act("browser_open", { url: "https://shop.test/" }))).toMatchObject({ kind: "error" });
    expect(deps.tabs.open).toHaveBeenCalledTimes(10);
  });

  it("only uses the conversation's own tabs", async () => {
    const { agent, makeTab } = setup(() => readResult());
    makeTab("mine", "conv1");
    makeTab("users", null);
    makeTab("other", "conv2");
    expect(await agent.perform("run1", "conv1", act("browser_read", { tab: "mine" }))).toMatchObject({ kind: "ok" });
    for (const tab of ["users", "other"]) {
      expect(await agent.perform("run1", "conv1", act("browser_read", { tab }))).toMatchObject({ kind: "error", text: expect.stringMatching(/No such agent tab/) });
    }
  });

  it("reads with the untrusted header", async () => {
    const { agent, makeTab } = setup(() => readResult());
    makeTab("t1", "conv1");
    const result = await agent.perform("run1", "conv1", act("browser_read", { tab: "t1" }));
    expect(result.text).toContain("untrusted content");
    expect(result.text).toContain('[1] button "Buy"');
  });

  it("asks before acting on a new site, then clicks with real input", async () => {
    const { agent, deps, makeTab } = setup((req) => (req.op === "target" ? targetResult() : { ok: true }));
    makeTab("t1", "conv1");
    expect(await agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }))).toEqual({
      kind: "needs_approval", approval: { kind: "site", host: "shop.test", action: "click", target: "Buy" },
    });
    expect(deps.sendInput).not.toHaveBeenCalled();
    const done = await agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, { approvedHosts: ["shop.test"] }));
    expect(done.kind).toBe("ok");
    expect(deps.runInPage.mock.calls.map(([, req]) => (req as Req).op)).toContain("highlight");
    expect(deps.sendInput).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining([expect.objectContaining({ type: "mouseDown", x: 50, y: 20 })]));
  });

  it("always asks before submitting a form, with its fields", async () => {
    const fields = [{ name: "Email", value: "a@b.c" }];
    const { agent, makeTab } = setup((req) => (req.op === "target" ? targetResult(element({ name: "Pay", submits: true }), { fields }) : { ok: true }));
    makeTab("t1", "conv1");
    expect(await agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, { approvedHosts: ["shop.test"] }))).toEqual({
      kind: "needs_approval", approval: { kind: "submit", host: "shop.test", action: "click", target: "Pay", fields },
    });
    expect(await agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, { approvedHosts: ["shop.test"], approvedSubmit: true, approvedTarget: "Pay" })))
      .toMatchObject({ kind: "ok" });
  });

  it("counts a submit approval only for the element it was given for", async () => {
    const { agent, deps, makeTab } = setup((req) => (req.op === "target" ? targetResult(element({ name: "Delete account", submits: true })) : { ok: true }));
    makeTab("t1", "conv1");
    const approved = { approvedHosts: ["shop.test"], approvedSubmit: true, approvedTarget: "Pay" };
    expect(await agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, approved))).toMatchObject({
      kind: "needs_approval", approval: { kind: "submit", target: "Delete account" },
    });
    expect(await agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, { ...approved, approvedSubmit: undefined, approvedTarget: "Delete account" })))
      .toMatchObject({ kind: "needs_approval", approval: { kind: "submit" } });
    expect(deps.sendInput).not.toHaveBeenCalled();
    expect(await agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, { ...approved, approvedTarget: "Delete account" })))
      .toMatchObject({ kind: "ok" });
  });

  it("checks the element again right before clicking", async () => {
    const cases: Array<[unknown, unknown]> = [
      [targetResult(element({ sensitive: true, editable: true })), { kind: "error", text: expect.stringMatching(/sensitive field/) }],
      [targetResult(element({ disabled: true })), { kind: "error", text: expect.stringMatching(/disabled/) }],
      [targetResult(element(), { offscreen: true }), { kind: "error", text: expect.stringMatching(/off screen; scroll to it first/) }],
      [targetResult(element({ submits: true }), { fields: [{ name: "Email", value: "a@b.c" }] }),
        { kind: "needs_approval", approval: { kind: "submit", target: "Buy", fields: [{ name: "Email", value: "a@b.c" }] } }],
      [targetResult(element({ name: "Pay", submits: true })), { kind: "needs_approval", approval: { kind: "submit", target: "Pay" } }],
    ];
    for (const [second, expected] of cases) {
      let targets = 0;
      const { agent, deps, makeTab } = setup((req) => (req.op === "target" ? (targets++ === 0 ? targetResult() : second) : { ok: true }));
      makeTab("t1", "conv1");
      expect(await agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, { approvedHosts: ["shop.test"] }))).toMatchObject(expected as object);
      expect(deps.sendInput).not.toHaveBeenCalled();
    }
  });

  it("refuses to click what is off screen", async () => {
    const { agent, deps, makeTab } = setup((req) => (req.op === "target" ? targetResult(element(), { offscreen: true }) : { ok: true }));
    makeTab("t1", "conv1");
    expect(await agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, { approvedHosts: ["shop.test"] })))
      .toEqual({ kind: "error", text: "Element 1 is off screen; scroll to it first." });
    expect(deps.sendInput).not.toHaveBeenCalled();
  });

  it("refuses to act on a page without a web address", async () => {
    for (const url of ["about:blank", "data:text/html,<button>Hi</button>"]) {
      const { agent, deps, makeTab } = setup((req) => (req.op === "target" ? targetResult() : { ok: true }));
      makeTab("t1", "conv1", url);
      for (const action of [act("browser_click", { tab: "t1", ref: 1 }, { approvedHosts: [""] }), act("browser_press", { tab: "t1", key: "Enter" })]) {
        expect(await agent.perform("run1", "conv1", action))
          .toEqual({ kind: "error", text: "This page has no web address to approve; open a web page first." });
      }
      expect(deps.sendInput).not.toHaveBeenCalled();
    }
  });

  it("refuses sensitive fields, file inputs and covered elements", async () => {
    const cases: Array<[unknown, RegExp]> = [
      [targetResult(element({ role: "password", editable: true, sensitive: true })), /sensitive field/],
      [targetResult(element({ role: "file", file: true })), /file upload/],
      [targetResult(element(), { covered: "Cookie banner" }), /covered by "Cookie banner"/],
    ];
    for (const [answer, message] of cases) {
      const { agent, deps, makeTab } = setup((req) => (req.op === "target" ? answer : { ok: true }));
      makeTab("t1", "conv1");
      const result = await agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, { approvedHosts: ["shop.test"] }));
      expect(result).toMatchObject({ kind: "error", text: expect.stringMatching(message) });
      expect(deps.sendInput).not.toHaveBeenCalled();
    }
  });

  it("types into a field and asks before submitting with Enter", async () => {
    const { agent, deps, makeTab } = setup((req) =>
      req.op === "target" ? targetResult(element({ role: "textbox", name: "Search", editable: true }), { entersSubmit: true }) : { ok: true });
    makeTab("t1", "conv1");
    const typed = await agent.perform("run1", "conv1", act("browser_type", { tab: "t1", ref: 1, text: "shoes", submit: false }, { approvedHosts: ["shop.test"] }));
    expect(typed.kind).toBe("ok");
    expect(deps.insertText).toHaveBeenCalledWith(expect.anything(), "shoes");
    const submit = await agent.perform("run1", "conv1", act("browser_type", { tab: "t1", ref: 1, text: "shoes", submit: true }, { approvedHosts: ["shop.test"] }));
    expect(submit).toMatchObject({ kind: "needs_approval", approval: { kind: "submit" } });
  });

  it("refuses keys while focus is in a sensitive field", async () => {
    const { agent, deps, makeTab } = setup((req) => (req.op === "focused" ? { name: "Password", sensitive: true, entersSubmit: true, fields: [] } : null));
    makeTab("t1", "conv1");
    expect(await agent.perform("run1", "conv1", act("browser_press", { tab: "t1", key: "Enter" }, { approvedHosts: ["shop.test"] })))
      .toMatchObject({ kind: "error" });
    expect(deps.sendInput).not.toHaveBeenCalled();
  });

  it("pauses on the user's input and hands back with a fresh read on resume", async () => {
    const { agent, tabs, makeTab } = setup((req) => (req.op === "read" ? readResult() : null));
    makeTab("t1", "conv1");
    await agent.perform("run1", "conv1", act("browser_read", { tab: "t1" }));
    agent.onUserInput(tabs.get("t1"));
    expect(agent.activity()).toMatchObject({ state: "paused", reason: "user" });
    let settled = false;
    const waiting = agent.perform("run1", "conv1", act("browser_read", { tab: "t1" })).then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    agent.resume();
    expect((await waiting).text).toMatch(/took over and handed back[\s\S]*Hello shop/);
    expect(agent.activity()).toMatchObject({ state: "acting" });
  });

  it("stops a paused action when the run ends", async () => {
    const { agent, makeTab } = setup(() => readResult());
    makeTab("t1", "conv1");
    await agent.perform("run1", "conv1", act("browser_read", { tab: "t1" }));
    agent.takeOver();
    expect(agent.activity()).toMatchObject({ state: "paused", reason: "user" });
    const waiting = agent.perform("run1", "conv1", act("browser_read", { tab: "t1" }));
    agent.end("run1");
    await expect(waiting).resolves.toEqual({ kind: "error", text: "Stopped." });
    expect(agent.activity()).toBeNull();
  });

  it("waits while the panel is hidden and carries on when it shows again", async () => {
    const { agent, makeTab } = setup(() => readResult());
    makeTab("t1", "conv1");
    await agent.perform("run1", "conv1", act("browser_read", { tab: "t1" }));
    agent.onHide();
    expect(agent.activity()).toMatchObject({ state: "paused", reason: "hidden" });
    const waiting = agent.perform("run1", "conv1", act("browser_read", { tab: "t1" }));
    agent.onShow();
    expect((await waiting).text).toMatch(/took over and handed back/);
    agent.takeOver();
    agent.onShow(); // a pause of the user's own isn't ended by showing the panel
    expect(agent.activity()).toMatchObject({ state: "paused", reason: "user" });
  });

  it("pauses during the highlight instead of clicking", async () => {
    const { agent, deps, makeTab } = setup((req) => (req.op === "target" ? targetResult() : req.op === "read" ? readResult() : { ok: true }));
    makeTab("t1", "conv1");
    deps.sleep.mockImplementationOnce(async () => { agent.takeOver(); });
    const waiting = agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, { approvedHosts: ["shop.test"] }));
    await new Promise((r) => setTimeout(r, 0));
    agent.resume();
    expect((await waiting).text).toMatch(/took over/);
    expect(deps.sendInput).not.toHaveBeenCalled();
  });

  it("doesn't click when the run ends during the highlight", async () => {
    const { agent, deps, makeTab } = setup((req) => (req.op === "target" ? targetResult() : { ok: true }));
    makeTab("t1", "conv1");
    deps.sleep.mockImplementationOnce(async () => { agent.end("run1"); });
    const result = await agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, { approvedHosts: ["shop.test"] }));
    expect(result).toEqual({ kind: "error", text: "Stopped." });
    expect(deps.sendInput).not.toHaveBeenCalled();
  });

  it("doesn't click when a newer run replaces the old one during the highlight", async () => {
    const { agent, deps, makeTab } = setup((req) => (req.op === "target" ? targetResult() : { ok: true }));
    makeTab("t1", "conv1");
    deps.sleep.mockImplementationOnce(async () => { void agent.perform("run2", "conv1", act("browser_tabs", { action: "list" })); });
    const result = await agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, { approvedHosts: ["shop.test"] }));
    expect(result).toEqual({ kind: "error", text: "Stopped." });
    expect(deps.sendInput).not.toHaveBeenCalled();
  });

  it("never acts after an action timed out, even when the page wakes up", async () => {
    vi.useFakeTimers();
    try {
      let wake: (value: unknown) => void = () => {};
      let targets = 0;
      const { agent, deps, makeTab } = setup((req) => {
        if (req.op === "target" && targets++ === 0) return new Promise((resolve) => { wake = resolve; });
        return req.op === "target" ? targetResult() : { ok: true };
      });
      makeTab("t1", "conv1");
      const result = agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, { approvedHosts: ["shop.test"] }));
      await vi.advanceTimersByTimeAsync(20000);
      expect(await result).toMatchObject({ kind: "error", text: expect.stringMatching(/didn't respond in time/) });
      wake(targetResult()); // the page's dialog was dismissed
      await vi.advanceTimersByTimeAsync(1000);
      expect(deps.sendInput).not.toHaveBeenCalled();
      expect(deps.runInPage.mock.calls.map(([, req]) => (req as Req).op)).not.toContain("highlight");
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't type when the user takes over just before", async () => {
    const { agent, deps, makeTab } = setup((req) => {
      if (req.op === "target") return targetResult(element({ role: "textbox", name: "Search", editable: true }));
      if (req.op === "focus") {
        agent.takeOver();
        return { ok: true };
      }
      return req.op === "read" ? readResult() : { ok: true };
    });
    makeTab("t1", "conv1");
    const waiting = agent.perform("run1", "conv1", act("browser_type", { tab: "t1", ref: 1, text: "shoes", submit: false }, { approvedHosts: ["shop.test"] }));
    await new Promise((r) => setTimeout(r, 0));
    agent.resume();
    expect((await waiting).text).toMatch(/took over/);
    expect(deps.insertText).not.toHaveBeenCalled();
  });

  it("doesn't press Enter after typing when the run ends meanwhile", async () => {
    const { agent, deps, makeTab } = setup((req) =>
      req.op === "target" ? targetResult(element({ role: "textbox", name: "Search", editable: true })) : { ok: true });
    makeTab("t1", "conv1");
    deps.insertText.mockImplementationOnce(() => { agent.end("run1"); });
    const result = await agent.perform("run1", "conv1", act("browser_type", { tab: "t1", ref: 1, text: "shoes", submit: true }, { approvedHosts: ["shop.test"] }));
    expect(result).toEqual({ kind: "error", text: "Stopped." });
    expect(deps.sendInput).not.toHaveBeenCalled();
  });

  it("waits for the user to sign in", async () => {
    const { agent, tabs, makeTab } = setup(() => readResult());
    const tab = makeTab("t1", "conv1");
    await agent.perform("run1", "conv1", act("browser_read", { tab: "t1" }));
    tab.auth = { host: "shop.test" };
    agent.onTabUpdate(tabs.get("t1"));
    expect(agent.activity()).toMatchObject({ state: "waiting-user", reason: "sign-in" });
    tab.auth = null;
    agent.onTabUpdate(tabs.get("t1"));
    expect(agent.activity()).toMatchObject({ state: "acting" });
  });

  it("keeps the user's own pause when a sign-in prompt comes and goes", async () => {
    const { agent, tabs, makeTab } = setup(() => readResult());
    const tab = makeTab("t1", "conv1");
    await agent.perform("run1", "conv1", act("browser_read", { tab: "t1" }));
    agent.takeOver();
    tab.auth = { host: "shop.test" };
    agent.onTabUpdate(tabs.get("t1"));
    expect(agent.activity()).toMatchObject({ state: "waiting-user", reason: "sign-in" });
    agent.resume(); // Resume doesn't answer the sign-in prompt
    expect(agent.activity()).toMatchObject({ state: "waiting-user", reason: "sign-in" });
    agent.takeOver();
    tab.auth = null;
    agent.onTabUpdate(tabs.get("t1"));
    expect(agent.activity()).toMatchObject({ state: "paused", reason: "user" });
    agent.resume();
    expect(agent.activity()).toMatchObject({ state: "acting" });
  });

  it("keeps waiting while hidden after a sign-in is answered, and acts once shown", async () => {
    const { agent, tabs, makeTab } = setup(() => readResult());
    const tab = makeTab("t1", "conv1");
    await agent.perform("run1", "conv1", act("browser_read", { tab: "t1" }));
    agent.onHide();
    tab.auth = { host: "shop.test" };
    agent.onTabUpdate(tabs.get("t1"));
    expect(agent.activity()).toMatchObject({ state: "waiting-user", reason: "sign-in" });
    let settled = false;
    const waiting = agent.perform("run1", "conv1", act("browser_read", { tab: "t1" })).then((r) => { settled = true; return r; });
    tab.auth = null;
    agent.onTabUpdate(tabs.get("t1"));
    expect(agent.activity()).toMatchObject({ state: "paused", reason: "hidden" });
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    agent.onShow();
    expect((await waiting).text).toMatch(/handed back/);
    expect(agent.activity()).toMatchObject({ state: "acting" });
  });

  it("waits for every open sign-in prompt, and forgets the ones whose tab is gone", async () => {
    const { agent, tabs, makeTab } = setup(() => readResult());
    const one = makeTab("t1", "conv1");
    const two = makeTab("t2", "conv1");
    await agent.perform("run1", "conv1", act("browser_read", { tab: "t1" }));
    one.auth = { host: "shop.test" };
    two.auth = { host: "shop.test" };
    agent.onTabUpdate(tabs.get("t1"));
    agent.onTabUpdate(tabs.get("t2"));
    one.auth = null;
    agent.onTabUpdate(tabs.get("t1"));
    expect(agent.activity()).toMatchObject({ state: "waiting-user", reason: "sign-in" });
    tabs.delete("t2");
    agent.resume();
    expect(agent.activity()).toMatchObject({ state: "acting" });
  });

  it("blocks downloads only while acting on its own tab, and says so", async () => {
    const { agent, deps, tabs, makeTab } = setup((req) => (req.op === "target" ? targetResult() : { ok: true }));
    makeTab("t1", "conv1");
    makeTab("users", null);
    expect(agent.blocksDownloadFrom(tabs.get("t1"))).toBe(false); // no run yet
    deps.sendInput.mockImplementationOnce(() => { expect(agent.blocksDownloadFrom(tabs.get("t1"))).toBe(true); });
    const result = await agent.perform("run1", "conv1", act("browser_click", { tab: "t1", ref: 1 }, { approvedHosts: ["shop.test"] }));
    expect(result.text).toMatch(/download/i);
    expect(agent.blocksDownloadFrom(tabs.get("users"))).toBe(false);
  });

  it("attaches a screenshot only for models that can see it", async () => {
    const { agent, makeTab } = setup();
    makeTab("t1", "conv1");
    expect(await agent.perform("run1", "conv1", act("browser_screenshot", { tab: "t1" }))).toMatchObject({ kind: "ok", text: expect.stringMatching(/can't see images/) });
    const shot = await agent.perform("run1", "conv1", act("browser_screenshot", { tab: "t1" }, { canSeeImages: true }));
    expect(shot).toMatchObject({ kind: "ok", image: { mimeType: "image/jpeg" } });
  });
});
