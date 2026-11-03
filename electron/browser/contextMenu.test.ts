import { describe, it, expect, vi } from "vitest";
import { DEFAULT_LABELS, cleanLabels, contextMenuTemplate } from "./contextMenu.js";

type Item = { label?: string; type?: string; enabled?: boolean; click?: () => void };

function setup(params: Record<string, unknown>, { canGoBack = true, canGoForward = false } = {}) {
  const actions = {
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    openTab: vi.fn(),
    copyText: vi.fn(),
    download: vi.fn(),
    copyImageAt: vi.fn(),
    edit: vi.fn(),
    search: vi.fn(),
    find: vi.fn(),
  };
  const items = contextMenuTemplate(params as never, {
    labels: DEFAULT_LABELS,
    canGoBack,
    canGoForward,
    engineName: "Brave",
    actions,
  }) as Item[];
  const byLabel = (label: string) => {
    const item = items.find((i) => i.label === label);
    if (!item) throw new Error(`no item "${label}" in ${items.map((i) => i.label ?? "—").join(", ")}`);
    return item;
  };
  return { items, actions, byLabel, labels: items.map((i) => i.label ?? "—") };
}

describe("contextMenuTemplate", () => {
  it("offers navigation and find on a plain part of the page", () => {
    const { labels, byLabel, actions } = setup({ linkURL: "", selectionText: "", isEditable: false, mediaType: "none" });
    expect(labels).toEqual(["Back", "Forward", "Reload", "—", "Find in page…"]);
    expect(byLabel("Back").enabled).toBe(true);
    expect(byLabel("Forward").enabled).toBe(false);
    byLabel("Reload").click!();
    expect(actions.reload).toHaveBeenCalled();
    byLabel("Find in page…").click!();
    expect(actions.find).toHaveBeenCalled();
  });

  it("opens and copies web links", () => {
    const { labels, byLabel, actions } = setup({ linkURL: "https://example.com/a", selectionText: "", mediaType: "none" });
    expect(labels).toEqual(["Open link in new tab", "Copy link address"]);
    byLabel("Open link in new tab").click!();
    expect(actions.openTab).toHaveBeenCalledWith("https://example.com/a");
    byLabel("Copy link address").click!();
    expect(actions.copyText).toHaveBeenCalledWith("https://example.com/a");
  });

  it("ignores links that aren't http(s)", () => {
    const { labels } = setup({ linkURL: "javascript:alert(1)", selectionText: "", mediaType: "none" });
    expect(labels).not.toContain("Open link in new tab");
  });

  it("offers image actions, saving through the download list", () => {
    const { labels, byLabel, actions } = setup({ srcURL: "https://cdn.example.com/cat.png", mediaType: "image", x: 10, y: 20 });
    expect(labels).toEqual(["Open image in new tab", "Save image", "Copy image", "Copy image address"]);
    byLabel("Save image").click!();
    expect(actions.download).toHaveBeenCalledWith("https://cdn.example.com/cat.png");
    byLabel("Copy image").click!();
    expect(actions.copyImageAt).toHaveBeenCalledWith(10, 20);
  });

  it("puts link and image groups together, split by a separator", () => {
    const { labels } = setup({ linkURL: "https://example.com/a", srcURL: "https://example.com/i.png", mediaType: "image" });
    expect(labels.indexOf("—")).toBe(2);
    expect(labels).toContain("Save image");
  });

  it("offers editing commands in a text field, enabled from the edit flags", () => {
    const { labels, byLabel, actions } = setup({
      isEditable: true,
      selectionText: "hi",
      editFlags: { canUndo: false, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
    });
    expect(labels).toEqual(["Undo", "Redo", "—", "Cut", "Copy", "Paste", "Select all"]);
    expect(byLabel("Undo").enabled).toBe(false);
    expect(byLabel("Paste").enabled).toBe(true);
    byLabel("Paste").click!();
    expect(actions.edit).toHaveBeenCalledWith("paste");
  });

  it("copies or searches selected text, previewing a long selection", () => {
    const text = "a very long selection that goes on   and on past thirty characters";
    const { items, actions } = setup({ selectionText: text, mediaType: "none" });
    expect(items[0].label).toBe("Copy");
    expect(items[1].label).toBe("Search Brave for “a very long selection that goe…”");
    items[1].click!();
    expect(actions.search).toHaveBeenCalledWith(text);
  });
});

describe("cleanLabels", () => {
  it("keeps known string labels and defaults the rest", () => {
    const labels = cleanLabels({ back: "رجوع", reload: 42, bogus: "x", copy: "   " });
    expect(labels.back).toBe("رجوع");
    expect(labels.reload).toBe("Reload");
    expect(labels.copy).toBe("Copy");
    expect("bogus" in labels).toBe(false);
  });

  it("caps label length and copes with junk", () => {
    expect(cleanLabels({ back: "x".repeat(500) }).back).toHaveLength(100);
    expect(cleanLabels(null)).toEqual(DEFAULT_LABELS);
    expect(cleanLabels("nope")).toEqual(DEFAULT_LABELS);
  });
});
