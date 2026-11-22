import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Embedder } from "./embedder";
import { IndexStore } from "./store";
import { Indexer } from "./indexer";
import { searchCodebase } from "./search";

const RUN = process.env.RUN_INDEX_E2E === "1";
const d = RUN ? describe : describe.skip;

d("e2e: real Ollama + sqlite-vec", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "marven-e2e-"));
    await fs.writeFile(
      path.join(dir, "json.ts"),
      "export function parseJson(s: string){return JSON.parse(s);}",
    );
    await fs.writeFile(
      path.join(dir, "auth.ts"),
      "export function validateToken(t: string){return t.length>0;}",
    );
    await fs.writeFile(
      path.join(dir, "ui.ts"),
      "export function renderButton(){return 'button';}",
    );
    const e = new Embedder();
    const ok = await e.ensureModelInstalled();
    if (!ok.ok) throw new Error("ollama not ready: " + ok.error);
    const store = IndexStore.open(dir);
    const idx = new Indexer({ workspaceRoot: dir, store, embedder: e });
    await idx.runFull();
    store.close();
  }, 300_000);
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  it("finds the json parser by meaning", async () => {
    const r = await searchCodebase({ workspaceRoot: dir, query: "json parser", limit: 3 });
    expect(r[0].path).toBe("json.ts");
  });
});
