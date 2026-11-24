import { describe, it, expect } from "vitest";
import { autostartDecision, type AutostartInput } from "./autostart";

const root = "/Users/me/Marven Projects/cafe-menu";
const settled: AutostartInput = {
  pending: { convId: "c1", root, activated: true, expiresAt: 10_000 },
  now: 1_000,
  activeConversationId: "c1",
  lastAgentConvId: "c1",
  mode: "agent",
  workspaceRoot: root,
  workspaceTrusted: true,
  settingsLoaded: true,
  running: false,
  messageCount: 0,
};

describe("autostartDecision", () => {
  it("does nothing without a queued request", () => {
    expect(autostartDecision({ ...settled, pending: null })).toBe("wait");
  });

  it("sends once everything has settled", () => {
    expect(autostartDecision(settled)).toBe("send");
    // The first render with the conversation active counts too.
    expect(autostartDecision({ ...settled, pending: { ...settled.pending!, activated: false } })).toBe("send");
  });

  it("waits for the new conversation before it has been active", () => {
    expect(autostartDecision({ ...settled, activeConversationId: "old", pending: { ...settled.pending!, activated: false } })).toBe("wait");
  });

  it("drops it when the user switched to another conversation", () => {
    expect(autostartDecision({ ...settled, activeConversationId: "other" })).toBe("drop");
    expect(autostartDecision({ ...settled, activeConversationId: null })).toBe("drop");
  });

  it("drops it when it expired while another conversation is open", () => {
    expect(autostartDecision({ ...settled, activeConversationId: "old", now: 10_000, pending: { ...settled.pending!, activated: false } })).toBe("drop");
  });

  it("falls back to filling in the input when it expired on an empty thread", () => {
    expect(autostartDecision({ ...settled, now: 10_000, workspaceRoot: null })).toBe("fallback");
  });

  it("drops an expired one when the thread already has messages", () => {
    expect(autostartDecision({ ...settled, now: 10_000, messageCount: 2 })).toBe("drop");
  });

  it("waits for the switch, agent mode, settings, the folder, trust and an idle Agent", () => {
    expect(autostartDecision({ ...settled, lastAgentConvId: "old" })).toBe("wait");
    expect(autostartDecision({ ...settled, mode: "chat" })).toBe("wait");
    expect(autostartDecision({ ...settled, settingsLoaded: false })).toBe("wait");
    expect(autostartDecision({ ...settled, workspaceRoot: "/Users/me/elsewhere" })).toBe("wait");
    expect(autostartDecision({ ...settled, workspaceRoot: null })).toBe("wait");
    expect(autostartDecision({ ...settled, workspaceTrusted: false })).toBe("wait");
    expect(autostartDecision({ ...settled, running: true })).toBe("wait");
  });

  it("drops it when the user already started the thread themselves", () => {
    expect(autostartDecision({ ...settled, messageCount: 1 })).toBe("drop");
  });
});
