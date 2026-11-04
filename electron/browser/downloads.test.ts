import { describe, it, expect, vi } from "vitest";
import { quarantineValue, isFinished, createDownloads } from "./downloads.js";

describe("quarantineValue", () => {
  it("writes flags, hex epoch seconds and the app name", () => {
    expect(quarantineValue(1_700_000_000_000)).toBe("0081;6553f100;Marven;");
  });

  it("drops the milliseconds", () => {
    expect(quarantineValue(1_700_000_000_999)).toBe("0081;6553f100;Marven;");
  });
});

describe("isFinished", () => {
  it("is true for completed, cancelled, interrupted and blocked downloads that are done", () => {
    for (const state of ["completed", "cancelled", "interrupted", "blocked"]) {
      expect(isFinished({ state, item: null })).toBe(true);
    }
  });

  it("is false while the download item is still live", () => {
    expect(isFinished({ state: "progressing", item: {} })).toBe(false);
    expect(isFinished({ state: "interrupted", item: {} })).toBe(false);
  });

  it("is false for a done download still being flagged as quarantined", () => {
    expect(isFinished({ state: "progressing", item: null })).toBe(false);
  });
});

describe("createDownloads shouldBlock", () => {
  it("blocks a download the agent's tab started while acting", () => {
    const downloads = createDownloads({ onChange: vi.fn(), shouldBlock: (wc: { id: number }) => wc?.id === 3 });
    const event = { preventDefault: vi.fn() };
    const item = { getFilename: () => "report.pdf", cancel: vi.fn() };
    downloads.handle(event, item, { id: 3 });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(item.cancel).toHaveBeenCalled();
    expect(downloads.list()).toEqual([expect.objectContaining({ state: "blocked", filename: "report.pdf" })]);
  });
});
