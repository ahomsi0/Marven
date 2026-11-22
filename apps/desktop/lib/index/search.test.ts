import { describe, it, expect, vi, afterEach } from "vitest";
import { searchCodebase } from "./search";
import * as storeMod from "./store";
import * as embMod from "./embedder";
import { EMBED_DIM } from "./embedder";

afterEach(() => vi.restoreAllMocks());

describe("searchCodebase", () => {
  it("embeds query and forwards to store.search", async () => {
    const fakeStore = {
      search: vi
        .fn()
        .mockReturnValue([
          { path: "a.ts", startLine: 0, endLine: 1, text: "x", distance: 0.1 },
        ]),
      close: vi.fn(),
    };
    vi.spyOn(storeMod.IndexStore, "open").mockReturnValue(fakeStore as any);
    vi.spyOn(embMod.Embedder.prototype, "embed").mockResolvedValue(
      new Float32Array(EMBED_DIM),
    );
    const r = await searchCodebase({ workspaceRoot: "/tmp/ws", query: "auth flow" });
    expect(r).toHaveLength(1);
    expect(fakeStore.search).toHaveBeenCalledOnce();
    expect((fakeStore.search.mock.calls[0][0] as Float32Array).length).toBe(EMBED_DIM);
    expect(fakeStore.search.mock.calls[0][1]).toBe(8);
  });
  it("respects limit (capped at 20)", async () => {
    const fakeStore = { search: vi.fn().mockReturnValue([]), close: vi.fn() };
    vi.spyOn(storeMod.IndexStore, "open").mockReturnValue(fakeStore as any);
    vi.spyOn(embMod.Embedder.prototype, "embed").mockResolvedValue(
      new Float32Array(EMBED_DIM),
    );
    await searchCodebase({ workspaceRoot: "/tmp/ws", query: "q", limit: 50 });
    expect(fakeStore.search.mock.calls[0][1]).toBe(20);
  });
});
