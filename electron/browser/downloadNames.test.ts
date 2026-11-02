import { describe, it, expect, vi } from "vitest";
import { sanitizeFilename, uniqueName } from "./downloadNames.js";

describe("sanitizeFilename", () => {
  it("keeps ordinary names", () => {
    expect(sanitizeFilename("report.pdf")).toBe("report.pdf");
  });

  it("strips folders, leading dots and unsafe characters", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\x\\evil.exe")).toBe("evil.exe");
    expect(sanitizeFilename("..hidden")).toBe("hidden");
    expect(sanitizeFilename('a<b>:c"|?*.txt')).toBe("a_b__c____.txt");
  });

  it("falls back to 'download' and caps the length", () => {
    expect(sanitizeFilename("")).toBe("download");
    expect(sanitizeFilename("...")).toBe("download");
    expect(sanitizeFilename(undefined)).toBe("download");
    expect(sanitizeFilename("x".repeat(300) + ".zip").length).toBe(200);
  });

  it("strips leading whitespace mixed with dots", () => {
    expect(sanitizeFilename("  .bashrc")).toBe("bashrc");
    expect(sanitizeFilename(". .zshrc")).toBe("zshrc");
    expect(sanitizeFilename("  report.pdf  ")).toBe("report.pdf");
  });

  it("replaces DEL and bidi / format controls", () => {
    expect(sanitizeFilename("a\x7fb.txt")).toBe("a_b.txt");
    expect(sanitizeFilename("invoice\u202Efdp.exe")).toBe("invoice_fdp.exe");
    expect(sanitizeFilename("\u200E\u200F\u202A\u202B\u202C\u202D\u2066\u2067\u2068\u2069x")).toBe("__________x");
  });

  it("caps the name by UTF-8 bytes, keeping the extension", () => {
    const arabic = sanitizeFilename("ملف".repeat(84) + ".pdf");
    expect(Buffer.byteLength(arabic)).toBeLessThanOrEqual(200);
    expect(arabic.endsWith(".pdf")).toBe(true);
    expect(arabic.startsWith("ملف")).toBe(true);
  });

  it("never cuts a character in half", () => {
    const emoji = sanitizeFilename("😀".repeat(150) + ".txt");
    expect(Buffer.byteLength(emoji)).toBeLessThanOrEqual(200);
    expect(emoji.endsWith(".txt")).toBe(true);
    expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});

describe("uniqueName", () => {
  it("returns the name when free, else numbers it before the extension", () => {
    const taken = new Set(["a.pdf", "a (1).pdf", "notes"]);
    const exists = (n: string) => taken.has(n);
    expect(uniqueName("b.pdf", exists)).toBe("b.pdf");
    expect(uniqueName("a.pdf", exists)).toBe("a (2).pdf");
    expect(uniqueName("notes", exists)).toBe("notes (1)");
  });

  it("checks the timestamp fallback too", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(5000);
    const exists = (n: string) => n !== "a (5001).pdf";
    expect(uniqueName("a.pdf", exists)).toBe("a (5001).pdf");
    now.mockRestore();
  });
});
