import { describe, it, expect } from "vitest";
import { buildProblemReport, buildReportBody, MAX_ISSUE_URL_LENGTH } from "./problemReport";
import { ISSUES_URL } from "./glitchReport";

const appInfo = { version: "2.13.0", platform: "darwin 25.2 (arm64)", provider: "Groq", model: "llama-3.3-70b" };

function logLines(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `2026-11-02T10:00:00.000Z [main] ERROR something failed #${i} ${"x".repeat(40)}`);
}

describe("buildReportBody", () => {
  it("includes the description, app info and logs in order", () => {
    const body = buildReportBody({ description: "Chat froze", appInfo, logs: ["line a", "line b"] });
    expect(body).toBe(
      [
        "### What happened\n\nChat froze",
        "### App info\n\n- Marven: v2.13.0\n- OS: darwin 25.2 (arm64)\n- Provider: Groq\n- Model: llama-3.3-70b",
        "### Recent logs\n\n```text\nline a\nline b\n```",
      ].join("\n\n"),
    );
  });

  it("leaves out sections the user unticked, and missing provider/model", () => {
    const body = buildReportBody({ description: "", appInfo: { version: "1.0.0", platform: "win32" }, logs: null });
    expect(body).toContain("_No description given._");
    expect(body).toContain("- OS: win32");
    expect(body).not.toContain("Provider");
    expect(body).not.toContain("Recent logs");
    expect(buildReportBody({ description: "x", appInfo: null, logs: [] })).toBe("### What happened\n\nx");
  });

  it("uses a longer fence when a log line contains backticks", () => {
    const body = buildReportBody({ description: "x", appInfo: null, logs: ["a ``` b"] });
    expect(body).toContain("````text\na ``` b\n````");
  });
});

describe("buildProblemReport", () => {
  it("keeps everything when the URL is short", () => {
    const r = buildProblemReport({ description: "Terminal froze\nafter tabs", appInfo, logs: ["one"] });
    expect(r.title).toBe("Terminal froze");
    expect(r.omittedLogLines).toBe(0);
    const url = new URL(r.url);
    expect(`${url.origin}${url.pathname}`).toBe(ISSUES_URL);
    expect(url.searchParams.get("body")).toBe(r.body);
  });

  it("drops the oldest log lines with a note so the URL fits", () => {
    const logs = logLines(300);
    const r = buildProblemReport({ description: "It crashed", appInfo, logs });
    expect(r.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
    expect(r.omittedLogLines).toBeGreaterThan(0);
    expect(r.omittedLogLines).toBeLessThan(300);
    const urlBody = new URL(r.url).searchParams.get("body")!;
    expect(urlBody).toContain(`${r.omittedLogLines} earlier log lines left out`);
    // The newest line survives, the oldest doesn't.
    expect(urlBody).toContain("#299");
    expect(urlBody).not.toContain("#0 ");
    // Dropping one fewer line wouldn't have fit.
    const oneMore = buildReportBody({ description: "It crashed", appInfo, logs }, { omitLogLines: r.omittedLogLines - 1 });
    expect(new URLSearchParams({ title: r.title, body: oneMore }).toString().length + ISSUES_URL.length + 1).toBeGreaterThan(
      MAX_ISSUE_URL_LENGTH,
    );
    // The clipboard body still has every line.
    expect(r.body).toContain("#0 ");
    expect(r.body).not.toContain("left out");
  });

  it("shortens a long non-Latin description when nothing else fits", () => {
    const description = "تعطل التطبيق ".repeat(400);
    const r = buildProblemReport({ description, appInfo, logs: logLines(5) });
    expect(r.url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
    expect(r.descriptionTruncated).toBe(true);
    expect(r.omittedLogLines).toBe(5);
    expect(new URL(r.url).searchParams.get("body")).toContain("_(truncated)_");
  });

  it("respects a custom limit", () => {
    const r = buildProblemReport({ description: "x", appInfo: null, logs: logLines(50) }, 1500);
    expect(r.url.length).toBeLessThanOrEqual(1500);
  });
});
