import { describe, it, expect } from "vitest";
import { buffersToEntries, entriesToBuffers } from "./agentSession";

describe("agentSession", () => {
  it("round-trips buffer map through entries", () => {
    const m = new Map<string, { content: string; dirty: boolean; loading: boolean }>();
    m.set("a.ts", { content: "hello", dirty: true, loading: false });
    const entries = buffersToEntries(m);
    const back = entriesToBuffers(entries);
    expect(back.get("a.ts")).toEqual({ content: "hello", dirty: true, loading: false });
  });
});
