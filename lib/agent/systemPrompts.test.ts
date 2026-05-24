import { describe, it, expect } from "vitest";
import { makeLiteSystemPrompt, makeFullSystemPrompt } from "./systemPrompts";

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
