import { describe, it, expect } from "vitest";
import { formatContextBlock } from "./formatter";
import type { ResolvedMention } from "./types";

describe("formatContextBlock", () => {
  it("returns empty string when no resolved mentions", () => {
    expect(formatContextBlock([])).toBe("");
  });

  it("wraps a single ok mention body inside a <context> block", () => {
    const r: ResolvedMention = {
      mention: { kind: "file", path: "a.ts" },
      body: "### File: a.ts\n```typescript\nx\n```",
      truncated: false,
      ok: true,
    };
    const out = formatContextBlock([r]);
    expect(out.startsWith("<context>")).toBe(true);
    expect(out.endsWith("</context>")).toBe(true);
    expect(out).toContain("### File: a.ts");
  });

  it("includes a failure line for failed attachments", () => {
    const ok: ResolvedMention = {
      mention: { kind: "file", path: "a.ts" },
      body: "### File: a.ts\n```\n\n```",
      truncated: false,
      ok: true,
    };
    const bad: ResolvedMention = {
      mention: { kind: "web", url: "https://x.example/" },
      body: "",
      truncated: false,
      ok: false,
      error: "HTTP 404",
    };
    const out = formatContextBlock([ok, bad]);
    expect(out).toContain("### File: a.ts");
    expect(out).toContain("[Attachment failed: web https://x.example/ — HTTP 404]");
  });
});
