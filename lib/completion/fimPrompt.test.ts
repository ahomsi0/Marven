import { describe, it, expect } from "vitest";
import { buildFimPrompt } from "./fimPrompt";
import type { ContextWindow } from "./contextWindow";

const ctx: ContextWindow = {
  prefix: "function add(a, b) {\n",
  suffix: "\n}\n",
  filename: "math.ts",
  languageId: "typescript",
  cursorLine: 1,
};

describe("buildFimPrompt", () => {
  it("qwen-coder format wraps with <|fim_prefix|> / <|fim_suffix|> / <|fim_middle|>", () => {
    const p = buildFimPrompt(ctx, "qwen2.5-coder:7b");
    expect(p.format).toBe("qwen-fim");
    expect(p.raw).toBe(
      "<|fim_prefix|>function add(a, b) {\n<|fim_suffix|>\n}\n<|fim_middle|>",
    );
    expect(p.stop).toBeDefined();
  });

  it("deepseek-coder format uses <｜fim▁begin｜> markers", () => {
    const p = buildFimPrompt(ctx, "deepseek-coder:6.7b");
    expect(p.format).toBe("deepseek-fim");
    expect(p.raw).toContain("<｜fim▁begin｜>");
    expect(p.raw).toContain("<｜fim▁hole｜>");
    expect(p.raw).toContain("<｜fim▁end｜>");
  });

  it("codestral format uses inverted [SUFFIX]...[PREFIX]...", () => {
    const p = buildFimPrompt(ctx, "codestral-22b");
    expect(p.format).toBe("codestral-fim");
    expect(p.raw).toContain("[SUFFIX]");
    expect(p.raw).toContain("[PREFIX]");
    // suffix should appear before prefix
    const sIdx = p.raw!.indexOf("[SUFFIX]");
    const pIdx = p.raw!.indexOf("[PREFIX]");
    expect(sIdx).toBeLessThan(pIdx);
  });

  it("default chat format emits system+user messages", () => {
    const p = buildFimPrompt(ctx, "gpt-4o-mini");
    expect(p.format).toBe("plain");
    expect(p.messages).toBeDefined();
    expect(p.messages!.length).toBe(2);
    expect(p.messages![0].role).toBe("system");
    expect(p.messages![1].role).toBe("user");
    expect(p.messages![1].content).toContain("function add(a, b) {");
    expect(p.messages![1].content).toContain("math.ts");
    expect(p.messages![1].content).toContain("typescript");
  });

  it("populates stop sequences", () => {
    const p = buildFimPrompt(ctx, "gpt-4o-mini");
    expect(Array.isArray(p.stop)).toBe(true);
    expect(p.stop!.length).toBeGreaterThan(0);
  });
});
