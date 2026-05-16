import { describe, it, expect } from "vitest";
import { filterConversations, generateMarkdown } from "./chatHelpers";
import type { Conversation } from "@/types";

function makeConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "1",
    name: "Test",
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("filterConversations", () => {
  it("returns all when query is empty", () => {
    const convs = [makeConv({ name: "Alpha" }), makeConv({ id: "2", name: "Beta" })];
    expect(filterConversations(convs, "")).toHaveLength(2);
  });

  it("matches conversation name case-insensitively", () => {
    const convs = [makeConv({ name: "TypeScript tips" }), makeConv({ id: "2", name: "Python notes" })];
    expect(filterConversations(convs, "typescript")).toHaveLength(1);
    expect(filterConversations(convs, "typescript")[0].name).toBe("TypeScript tips");
  });

  it("matches message content", () => {
    const convs = [
      makeConv({
        name: "Chat",
        messages: [{ id: "m1", role: "user", content: "hello world", timestamp: new Date(), isStreaming: false }],
      }),
      makeConv({ id: "2", name: "Other", messages: [] }),
    ];
    expect(filterConversations(convs, "world")).toHaveLength(1);
  });

  it("returns empty when nothing matches", () => {
    const convs = [makeConv({ name: "Alpha" })];
    expect(filterConversations(convs, "xyz")).toHaveLength(0);
  });
});

describe("generateMarkdown", () => {
  it("includes conversation name in heading", () => {
    const conv = makeConv({ name: "My Chat" });
    expect(generateMarkdown(conv)).toContain("# My Chat");
  });

  it("includes user and assistant messages", () => {
    const conv = makeConv({
      name: "Chat",
      messages: [
        { id: "1", role: "user", content: "Hello AI", timestamp: new Date(), isStreaming: false },
        { id: "2", role: "assistant", content: "Hello human", timestamp: new Date(), isStreaming: false },
      ],
    });
    const md = generateMarkdown(conv);
    expect(md).toContain("**You:** Hello AI");
    expect(md).toContain("**Assistant:** Hello human");
  });

  it("includes provider and model in header when present", () => {
    const conv = makeConv({ name: "Chat", provider: "groq", model: "llama-3.3-70b-versatile" });
    const md = generateMarkdown(conv);
    expect(md).toContain("Groq");
    expect(md).toContain("llama-3.3-70b-versatile");
  });
});
