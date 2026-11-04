// Renderer side of the in-app browser (electron/browser/ does the work).

import searchEngineList from "@/electron/browser/searchEngines.json";
import type { BrowserAction, BrowserActionKind, BrowserResult } from "@/types";

export interface BrowserError {
  kind: "unreachable" | "certificate" | "crashed";
  description: string;
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  blocked: number;
  blockingEnabled: boolean;
  error: BrowserError | null;
  /** Find in page: the current match (1-based, 0 for none) and the total, or null. */
  find: { active: number; total: number } | null;
  /** A server asking for a username and password, or null. */
  auth: { host: string; realm: string; isProxy: boolean } | null;
  /** Opened by Marven's agent (its own tab). */
  agent: boolean;
}

/** What Marven's agent is doing in the browser (electron/browser/agent.js). */
export interface AgentActivity {
  tabId: string | null;
  state: "acting" | "paused" | "waiting-user";
  /** `target` is page text or a host: show it as plain text. */
  action: { kind: BrowserActionKind; target: string } | null;
  reason?: "user" | "sign-in" | "hidden";
}

export interface BrowserDownload {
  id: string;
  filename: string;
  state: "progressing" | "completed" | "cancelled" | "interrupted" | "blocked";
  receivedBytes: number;
  totalBytes: number;
  /** For "blocked": how many downloads in a row were stopped. */
  count?: number;
}

export type SearchEngineId = "brave" | "google" | "duckduckgo" | "bing";

export interface SearchEngine {
  id: SearchEngineId;
  name: string;
  searchUrl: string;
  homeUrl: string;
}

export interface BrowserSnapshot {
  tabs: BrowserTab[];
  activeId: string | null;
  /** A closed tab can be reopened. */
  canReopen: boolean;
  downloads: BrowserDownload[];
  searchEngine: Pick<SearchEngine, "id" | "name" | "searchUrl">;
  /** Null when no agent run is using the browser. */
  agentActivity: AgentActivity | null;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  addedAt: number;
}

export interface Suggestion {
  kind: "bookmark" | "history";
  url: string;
  title: string;
}

export type TabCommand = "back" | "forward" | "reload" | "stop" | "retry";

/** A page's readable text and selection (electron/browser/pageText.js). Untrusted. */
export interface PageExtract {
  url: string;
  title: string;
  selection: string;
  text: string;
}

export interface BrowserBridge {
  show: (bounds: BrowserBounds) => Promise<boolean>;
  setBounds: (bounds: BrowserBounds) => void;
  hide: () => void;
  freeze: () => Promise<string | null>;
  unfreeze: () => void;
  setFocused: (focused: boolean) => void;
  snapshot: () => Promise<BrowserSnapshot | null>;
  newTab: (url?: string) => Promise<string | null>;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  moveTab: (id: string, toIndex: number) => void;
  reopenClosedTab: () => void;
  navigate: (id: string, url: string) => Promise<boolean>;
  command: (id: string, name: TabCommand) => void;
  /** The page in a tab (the active one if no id), or null for blank/error tabs. */
  extractPage: (id?: string) => Promise<PageExtract | null>;
  /** Searches the page; `again` moves to the next (or previous) match of the same text. */
  find: (id: string, text: string, options?: { forward?: boolean; again?: boolean }) => void;
  stopFind: (id: string) => void;
  /** Answers a sign-in prompt; a null username cancels it. */
  answerAuth: (id: string, username: string | null, password: string | null) => void;
  /** Right-click menu labels in the app's language (keys in electron/browser/contextMenu.js). */
  setMenuLabels: (labels: Record<string, string>) => void;
  toggleBookmark: (url: string, title: string) => Promise<boolean>;
  removeBookmark: (id: string) => Promise<void>;
  listBookmarks: (query: string) => Promise<Bookmark[]>;
  isBookmarked: (url: string) => Promise<boolean>;
  suggest: (query: string) => Promise<Suggestion[]>;
  setBlocking: (host: string, enabled: boolean) => void;
  cancelDownload: (id: string) => void;
  showDownload: (id: string) => void;
  clearBrowsingData: () => Promise<boolean>;
  onSnapshot: (cb: (snapshot: BrowserSnapshot) => void) => () => void;
  onFocusAddress: (cb: () => void) => () => void;
  onOpenFind: (cb: () => void) => () => void;
  /** Marven's agent driving its own tabs. `run` answers null if the window isn't Marven's. */
  agent: {
    run: (runId: string, conversationId: string, action: BrowserAction) => Promise<BrowserResult | null>;
    resume: () => void;
    takeOver: () => void;
    end: (runId: string) => void;
  };
}

/** The Electron bridge, or null outside the desktop app (e.g. `next dev` in a browser). */
export function getBrowserBridge(): BrowserBridge | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((window as any).marvenElectron?.browser as BrowserBridge | undefined) ?? null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Search engines offered in onboarding and Settings; the first is the default (Brave). */
export const SEARCH_ENGINES = searchEngineList as SearchEngine[];
export const DEFAULT_SEARCH_ENGINE = SEARCH_ENGINES[0];
export const SEARCH_URL = DEFAULT_SEARCH_ENGINE.searchUrl;

/**
 * Turn address-bar input into a URL: full http(s) URLs pass through, bare
 * hosts get a scheme (http for localhost), anything else becomes a search.
 * Never returns a non-http(s) URL.
 */
export function normalizeBrowserInput(input: string, searchUrl: string = SEARCH_URL): string | null {
  const text = input.trim();
  if (!text) return null;

  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text).href;
    } catch {
      return searchUrl + encodeURIComponent(text);
    }
  }

  if (/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(:\d+)?(\/\S*)?$/i.test(text)) {
    try {
      return new URL(`http://${text}`).href;
    } catch {
      // e.g. an out-of-range port; fall through to search
    }
  }

  if (!/\s/.test(text) && /^[^\s/:]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text)) {
    try {
      return new URL(`https://${text}`).href;
    } catch {
      // fall through to search
    }
  }

  return searchUrl + encodeURIComponent(text);
}
