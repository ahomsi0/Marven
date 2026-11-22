import { Embedder } from "./embedder";
import { IndexStore } from "./store";
import type { SearchResult } from "@/types";

export type { SearchResult };

export async function searchCodebase(opts: {
  workspaceRoot: string;
  query: string;
  limit?: number;
}): Promise<SearchResult[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 8, 20));
  const embedder = new Embedder();
  const v = await embedder.embed(opts.query);
  const store = IndexStore.open(opts.workspaceRoot);
  try {
    return store.search(v, limit);
  } finally {
    store.close();
  }
}
