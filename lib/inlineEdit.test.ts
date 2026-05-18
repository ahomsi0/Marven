import { describe, it, expect } from "vitest";
import { stripCodeFences } from "./inlineEdit";

describe("stripCodeFences", () => {
  it("returns plain text unchanged", () => {
    expect(stripCodeFences("const x = 1")).toBe("const x = 1");
  });

  it("strips a fenced block with language tag", () => {
    expect(stripCodeFences("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("strips a fenced block without language tag", () => {
    expect(stripCodeFences("```\nhello\n```")).toBe("hello");
  });

  it("handles fenced block with no trailing newline before close", () => {
    expect(stripCodeFences("```tsx\nfoo```")).toBe("foo");
  });

  it("leaves inner ``` blocks intact (only outermost fence stripped)", () => {
    const input = "```ts\nconst md = `inner ``` still here`;\nconst y = 2;\n```";
    const out = stripCodeFences(input);
    expect(out).toContain("inner ``` still here");
    expect(out).not.toMatch(/^```/);
    expect(out).not.toMatch(/```$/);
  });

  it("strips only the opener if no closer (partial stream)", () => {
    expect(stripCodeFences("```ts\nconst x = 1;")).toBe("const x = 1;");
  });

  it("strips only the closer if no opener", () => {
    expect(stripCodeFences("const x = 1;\n```")).toBe("const x = 1;");
  });

  it("preserves indentation inside the fenced block", () => {
    const input = "```ts\n  const x = 1;\n    if (true) return;\n```";
    expect(stripCodeFences(input)).toBe("  const x = 1;\n    if (true) return;");
  });

  it("tolerates carriage returns from a streaming source", () => {
    expect(stripCodeFences("```ts\r\nconst x = 1;\r\n```")).toBe("const x = 1;");
  });

  it("does not strip a single ``` that is not at an end", () => {
    const input = "before ``` middle ``` after";
    expect(stripCodeFences(input)).toBe(input);
  });
});
