import { describe, it, expect } from "vitest";
import { PROJECT_KEY, PROJECT_RECENT_MS, THREADS_KEY, THREAD_LIMIT, THREAD_PROJECTS, appendThread, forgetProject, isRecentProject, loadProject, loadThread, saveProject } from "./project";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), data };
}

describe("companion project", () => {
  it("round-trips the project", () => {
    const s = memoryStorage();
    saveProject(s, { root: "/Users/me/Marven Projects/ali-itani", name: "ali itani", at: 5 });
    expect(loadProject(s)).toEqual({ root: "/Users/me/Marven Projects/ali-itani", name: "ali itani", at: 5 });
  });
  it("ignores missing or malformed data", () => {
    expect(loadProject(memoryStorage())).toBeNull();
    expect(loadProject(memoryStorage({ [PROJECT_KEY]: "{oops" }))).toBeNull();
    expect(loadProject(memoryStorage({ [PROJECT_KEY]: JSON.stringify({ root: "", name: "x", at: 1 }) }))).toBeNull();
    expect(loadProject(memoryStorage({ [PROJECT_KEY]: JSON.stringify({ root: "/a", name: "x" }) }))).toBeNull();
  });
  it("is recent for a while after Mini Me worked on it", () => {
    const p = { root: "/a", name: "x", at: 1_000 };
    expect(isRecentProject(p, 1_000 + PROJECT_RECENT_MS - 1)).toBe(true);
    expect(isRecentProject(p, 1_000 + PROJECT_RECENT_MS)).toBe(false);
  });
});

describe("project threads", () => {
  function store(initial: Record<string, string> = {}) {
    const data: Record<string, string> = { ...initial };
    return {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => void (data[k] = v),
      removeItem: (k: string) => void delete data[k],
      data,
    };
  }
  it("appends with unique ids and keeps the last 20", () => {
    const s = store();
    for (let i = 0; i < 25; i++) appendThread(s, "/p/a", [{ role: "user", content: `m${i}` }], 1000 + i);
    const t = loadThread(s, "/p/a");
    expect(t).toHaveLength(THREAD_LIMIT);
    expect(t[0].content).toBe("m5");
    expect(new Set(t.map((m) => m.id)).size).toBe(THREAD_LIMIT);
  });
  it("skips empty messages", () => {
    const s = store();
    expect(appendThread(s, "/p/a", [{ role: "assistant", content: "  " }], 1)).toEqual([]);
  });
  it("keeps the 10 most recently used projects", () => {
    const s = store();
    for (let i = 0; i < 12; i++) appendThread(s, `/p/${i}`, [{ role: "user", content: "x" }], i);
    expect(Object.keys(JSON.parse(s.data[THREADS_KEY]))).toHaveLength(THREAD_PROJECTS);
    expect(loadThread(s, "/p/0")).toEqual([]);
    expect(loadThread(s, "/p/11")).toHaveLength(1);
  });
  it("ignores malformed storage", () => {
    expect(loadThread(store({ [THREADS_KEY]: "{nope" }), "/p/a")).toEqual([]);
    expect(loadThread(store({ [THREADS_KEY]: JSON.stringify({ "/p/a": { at: 1, messages: [{ role: "x" }] } }) }), "/p/a")).toEqual([]);
  });
  it("forgets a project and its thread", () => {
    const s = store();
    saveProject(s, { root: "/p/a", name: "a", at: 1 });
    appendThread(s, "/p/a", [{ role: "user", content: "x" }], 1);
    forgetProject(s, "/p/a");
    expect(loadProject(s)).toBeNull();
    expect(loadThread(s, "/p/a")).toEqual([]);
  });
});
