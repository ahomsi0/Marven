import { describe, it, expect } from "vitest";
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
});

describe("uniqueName", () => {
  it("returns the name when free, else numbers it before the extension", () => {
    const taken = new Set(["a.pdf", "a (1).pdf", "notes"]);
    const exists = (n: string) => taken.has(n);
    expect(uniqueName("b.pdf", exists)).toBe("b.pdf");
    expect(uniqueName("a.pdf", exists)).toBe("a (2).pdf");
    expect(uniqueName("notes", exists)).toBe("notes (1)");
  });
});
