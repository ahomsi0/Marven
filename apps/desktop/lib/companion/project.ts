// The project Mini Me built last, so a follow-up ("change the background to
// red") edits it instead of starting a new one. Kept in localStorage; pure, so
// it can be unit-tested.

export interface CompanionProject {
  /** The project folder (made by Mini Me under the projects folder). */
  root: string;
  name: string;
  /** When Mini Me last built or changed it (ms since epoch). */
  at: number;
}

export const PROJECT_KEY = "marven-companion-project";
/** "it" means the project for this long after Mini Me last worked on it. */
export const PROJECT_RECENT_MS = 30 * 60_000;

const MAX_FIELD = 4096;

function isProject(value: unknown): value is CompanionProject {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.root === "string" && p.root.length > 0 && p.root.length <= MAX_FIELD &&
    typeof p.name === "string" && p.name.length > 0 && p.name.length <= MAX_FIELD &&
    typeof p.at === "number" && Number.isFinite(p.at)
  );
}

export function loadProject(storage: Pick<Storage, "getItem">): CompanionProject | null {
  try {
    const raw = storage.getItem(PROJECT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isProject(parsed) ? { root: parsed.root, name: parsed.name, at: parsed.at } : null;
  } catch {
    return null;
  }
}

export function saveProject(storage: Pick<Storage, "setItem">, project: CompanionProject): void {
  try {
    storage.setItem(PROJECT_KEY, JSON.stringify(project));
  } catch {
    /* quota errors are non-fatal */
  }
}

/** True while "it" should mean this project. */
export function isRecentProject(project: CompanionProject, now: number): boolean {
  return now - project.at >= 0 && now - project.at < PROJECT_RECENT_MS;
}

/** One message of a project's history, shared by Mini Me's runs and Marven's Agent conversation. */
export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export const THREADS_KEY = "marven-companion-threads";
export const THREAD_LIMIT = 20;
export const THREAD_PROJECTS = 10;
const MAX_CONTENT = 20_000;

interface StoredThread {
  at: number;
  messages: ThreadMessage[];
}

function isThreadMessage(value: unknown): value is ThreadMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return typeof m.id === "string" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
}

function readThreads(storage: Pick<Storage, "getItem">): Record<string, StoredThread> {
  try {
    const raw = storage.getItem(THREADS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, StoredThread> = {};
    for (const [root, value] of Object.entries(parsed as Record<string, unknown>)) {
      const t = value as { at?: unknown; messages?: unknown } | null;
      if (!t || typeof t.at !== "number" || !Array.isArray(t.messages)) continue;
      out[root] = { at: t.at, messages: t.messages.filter(isThreadMessage).slice(-THREAD_LIMIT) };
    }
    return out;
  } catch {
    return {};
  }
}

/** The project's history (oldest first), or [] when there is none. */
export function loadThread(storage: Pick<Storage, "getItem">, root: string): ThreadMessage[] {
  return readThreads(storage)[root]?.messages ?? [];
}

/** Adds messages to the project's history (empty ones skipped) and returns it. */
export function appendThread(
  storage: Pick<Storage, "getItem" | "setItem">,
  root: string,
  messages: { role: "user" | "assistant"; content: string }[],
  now: number = Date.now(),
): ThreadMessage[] {
  const all = readThreads(storage);
  const prev = all[root]?.messages ?? [];
  const added = messages
    .filter((m) => m.content.trim())
    .map((m, i) => ({ id: `minime-${now.toString(36)}-${prev.length + i + 1}`, role: m.role, content: m.content.slice(0, MAX_CONTENT) }));
  if (added.length === 0) return prev;
  const next = [...prev, ...added].slice(-THREAD_LIMIT);
  all[root] = { at: now, messages: next };
  const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, THREAD_PROJECTS);
  try {
    storage.setItem(THREADS_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* quota errors are non-fatal */
  }
  return next;
}

/** The project's folder is gone: drop it as the current project and drop its history. */
export function forgetProject(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, root: string): void {
  try {
    if (loadProject(storage)?.root === root) storage.removeItem(PROJECT_KEY);
    const all = readThreads(storage);
    if (all[root]) {
      delete all[root];
      storage.setItem(THREADS_KEY, JSON.stringify(all));
    }
  } catch {
    /* non-fatal */
  }
}
