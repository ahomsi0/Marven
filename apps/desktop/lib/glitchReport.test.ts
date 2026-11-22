import { describe, it, expect } from "vitest";
import { glitchBody, glitchIssueUrl, glitchTitle, ISSUES_URL } from "./glitchReport";

const diag = { version: "2.13.0", platform: "darwin", provider: "Groq" };

describe("glitchTitle", () => {
  it("uses the first line of the description", () => {
    expect(glitchTitle("  Terminal froze\nafter switching tabs")).toBe("Terminal froze");
  });

  it("falls back when the description is empty", () => {
    expect(glitchTitle("   ")).toBe("Glitch report");
  });

  it("truncates long first lines", () => {
    const title = glitchTitle("x".repeat(200));
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("glitchBody", () => {
  it("includes diagnostics when given", () => {
    const body = glitchBody("It crashed", diag);
    expect(body).toContain("### What happened\n\nIt crashed");
    expect(body).toContain("- Marven: v2.13.0");
    expect(body).toContain("- Platform: darwin");
    expect(body).toContain("- Provider: Groq");
  });

  it("leaves diagnostics out when the user opts out", () => {
    expect(glitchBody("It crashed", null)).not.toContain("Diagnostics");
  });

  it("truncates very long descriptions", () => {
    const body = glitchBody("y".repeat(10_000), null);
    expect(body.length).toBeLessThan(4200);
    expect(body).toContain("_(truncated)_");
  });
});

describe("glitchIssueUrl", () => {
  it("points at the repo's new-issue page with encoded title and body", () => {
    const url = new URL(glitchIssueUrl("Chat & agent # froze", diag));
    expect(`${url.origin}${url.pathname}`).toBe(ISSUES_URL);
    expect(url.searchParams.get("title")).toBe("Chat & agent # froze");
    expect(url.searchParams.get("body")).toContain("Chat & agent # froze");
  });
});
