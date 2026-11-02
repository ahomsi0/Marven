// Renderer side of the in-app browser (electron/browser/ does the work).

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
}

export interface BrowserDownload {
  id: string;
  filename: string;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  receivedBytes: number;
  totalBytes: number;
}

export interface BrowserSnapshot {
  tabs: BrowserTab[];
  activeId: string | null;
  downloads: BrowserDownload[];
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

export const SEARCH_URL = "https://search.brave.com/search?q=";

/**
 * Turn address-bar input into a URL: full http(s) URLs pass through, bare
 * hosts get a scheme (http for localhost), anything else becomes a search.
 * Never returns a non-http(s) URL.
 */
export function normalizeBrowserInput(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text).href;
    } catch {
      return SEARCH_URL + encodeURIComponent(text);
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

  return SEARCH_URL + encodeURIComponent(text);
}
