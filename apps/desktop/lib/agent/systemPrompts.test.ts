import { describe, it, expect } from "vitest";
import { makeLiteSystemPrompt, makeFullSystemPrompt, currentDateTimeLine } from "./systemPrompts";

describe("makeLiteSystemPrompt", () => {
  it("includes workspaceRoot", () => {
    const p = makeLiteSystemPrompt("/my/workspace");
    expect(p).toContain("/my/workspace");
  });

  it("prepends memory block when provided", () => {
    const p = makeLiteSystemPrompt("/ws", "remember this");
    expect(p.startsWith("### Memory")).toBe(true);
    expect(p).toContain("remember this");
  });

  it("omits memory block when not provided", () => {
    const p = makeLiteSystemPrompt("/ws");
    expect(p).not.toContain("### Memory");
  });

  it("omits memory block when memory is empty string", () => {
    const p = makeLiteSystemPrompt("/ws", "");
    expect(p).not.toContain("### Memory");
  });

  it("embeds the workspace file tree when provided", () => {
    const p = makeLiteSystemPrompt("/ws", undefined, "index.html\nstyle.css");
    expect(p).toContain("Workspace files:");
    expect(p).toContain("index.html");
    expect(p).toContain("style.css");
  });

  it("omits the workspace block when fileTree is empty", () => {
    const p = makeLiteSystemPrompt("/ws", undefined, "   ");
    expect(p).not.toContain("Workspace files:");
  });

  it("combines memory and fileTree together when both provided", () => {
    const p = makeLiteSystemPrompt("/ws", "user prefers tabs", "index.html");
    expect(p.startsWith("### Memory")).toBe(true);
    expect(p).toContain("user prefers tabs");
    expect(p).toContain("Workspace files:");
    expect(p).toContain("index.html");
  });
});

describe("makeFullSystemPrompt", () => {
  it("includes workspaceRoot", () => {
    const p = makeFullSystemPrompt("/my/workspace");
    expect(p).toContain("/my/workspace");
  });

  it("prepends memory block when provided", () => {
    const p = makeFullSystemPrompt("/ws", "remember this");
    expect(p.startsWith("### Memory")).toBe(true);
    expect(p).toContain("remember this");
  });

  it("omits memory block when not provided", () => {
    const p = makeFullSystemPrompt("/ws");
    expect(p).not.toContain("### Memory");
  });
});

describe("prompt length comparison", () => {
  it("lite prompt is shorter than full prompt for same inputs", () => {
    const lite = makeLiteSystemPrompt("/ws");
    const full = makeFullSystemPrompt("/ws");
    expect(lite.length).toBeLessThan(full.length);
  });

  it("lite prompt with memory is shorter than full prompt with memory", () => {
    const mem = "remember the user prefers TypeScript";
    const lite = makeLiteSystemPrompt("/ws", mem);
    const full = makeFullSystemPrompt("/ws", mem);
    expect(lite.length).toBeLessThan(full.length);
  });
});

describe("current date/time line", () => {
  const NOW = new Date("2026-11-02T19:26:05Z");

  it("renders ISO with the zone offset and a human form", () => {
    const line = currentDateTimeLine(NOW, "America/New_York");
    expect(line).toContain("2026-11-02T14:26:05-05:00");
    expect(line).toContain("Monday, November 2, 2026");
    expect(line).toContain("2:26");
    expect(line).toContain("America/New_York");
    expect(line).toMatch(/training data/);
  });

  it("handles positive and fractional offsets", () => {
    expect(currentDateTimeLine(NOW, "Asia/Kolkata")).toContain("2026-11-03T00:56:05+05:30");
    expect(currentDateTimeLine(NOW, "UTC")).toContain("2026-11-02T19:26:05+00:00");
  });

  it("is included in both agent prompts and computed per call", () => {
    const lite = makeLiteSystemPrompt("/ws", undefined, undefined, undefined, NOW);
    const full = makeFullSystemPrompt("/ws", undefined, undefined, NOW);
    expect(lite).toContain("Current date and time:");
    expect(full).toContain("Current date and time:");
    const later = makeFullSystemPrompt("/ws", undefined, undefined, new Date("2030-01-01T12:00:00Z"));
    expect(later).toContain("2030");
    expect(later).not.toContain("2026-11-02");
  });
});
