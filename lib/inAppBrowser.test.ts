import { describe, it, expect } from "vitest";
import { SEARCH_URL, normalizeBrowserInput } from "./inAppBrowser";

describe("normalizeBrowserInput", () => {
  it("returns null for empty input", () => {
    expect(normalizeBrowserInput("   ")).toBeNull();
  });

  it("keeps full http(s) URLs", () => {
    expect(normalizeBrowserInput("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeBrowserInput("http://localhost:3000")).toBe("http://localhost:3000/");
  });

  it("adds https to bare domains", () => {
    expect(normalizeBrowserInput("github.com")).toBe("https://github.com/");
    expect(normalizeBrowserInput("docs.python.org/3/library")).toBe("https://docs.python.org/3/library");
  });

  it("uses http for localhost and loopback addresses", () => {
    expect(normalizeBrowserInput("localhost:5173")).toBe("http://localhost:5173/");
    expect(normalizeBrowserInput("127.0.0.1:8080/api")).toBe("http://127.0.0.1:8080/api");
  });

  it("searches everything else", () => {
    expect(normalizeBrowserInput("how to center a div")).toBe(SEARCH_URL + "how%20to%20center%20a%20div");
    expect(normalizeBrowserInput("react")).toBe(SEARCH_URL + "react");
  });

  it("never produces a non-web URL", () => {
    for (const input of ["javascript:alert(1)", "file:///etc/passwd", "chrome://settings", "data:text/html,hi"]) {
      expect(normalizeBrowserInput(input)!.startsWith(SEARCH_URL)).toBe(true);
    }
  });
});
