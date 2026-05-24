import { describe, it, expect } from "vitest";
import { IndexStore } from "./store";

function makeVec(seed: number, dim = 768): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(seed + i * 0.01);
  let n = 0;
  for (let i = 0; i < dim; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < dim; i++) v[i] /= n;
  return v;
}

describe("IndexStore", () => {
  it("round-trips upsert + search", () => {
    const s = IndexStore.openInMemory();
    s.upsertFile({
      path: "a.ts",
      mtimeMs: 1,
      sizeBytes: 10,
      hash: "h1",
      chunks: [
        { startLine: 0, endLine: 5, text: "alpha", embedding: makeVec(1) },
        { startLine: 6, endLine: 11, text: "beta", embedding: makeVec(2) },
      ],
    });
    const results = s.search(makeVec(1), 1);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe("a.ts");
    expect(results[0].text).toBe("alpha");
    expect(results[0].distance).toBeLessThan(0.001);
    s.close();
  });
  it("replaces stale chunks on re-upsert", () => {
    const s = IndexStore.openInMemory();
    s.upsertFile({
      path: "a.ts",
      mtimeMs: 1,
      sizeBytes: 10,
      hash: "h1",
      chunks: [{ startLine: 0, endLine: 5, text: "old", embedding: makeVec(1) }],
    });
    s.upsertFile({
      path: "a.ts",
      mtimeMs: 2,
      sizeBytes: 12,
      hash: "h2",
      chunks: [{ startLine: 0, endLine: 5, text: "new", embedding: makeVec(2) }],
    });
    expect(s.stats().chunkCount).toBe(1);
    expect(s.getFileHash("a.ts")).toBe("h2");
    const r = s.search(makeVec(2), 1);
    expect(r[0].text).toBe("new");
    s.close();
  });
  it("removeFile drops chunks", () => {
    const s = IndexStore.openInMemory();
    s.upsertFile({
      path: "a.ts",
      mtimeMs: 1,
      sizeBytes: 10,
      hash: "h1",
      chunks: [{ startLine: 0, endLine: 5, text: "x", embedding: makeVec(1) }],
    });
    s.removeFile("a.ts");
    expect(s.stats().chunkCount).toBe(0);
    expect(s.getFileHash("a.ts")).toBeNull();
    s.close();
  });
  it("getFileHash returns null for unknown path", () => {
    const s = IndexStore.openInMemory();
    expect(s.getFileHash("nope.ts")).toBeNull();
    s.close();
  });
});
