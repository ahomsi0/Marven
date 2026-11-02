// Renderer side of the in-app browser (electron/browserView.js does the work).

export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserBridge {
  show: (bounds: BrowserBounds, url?: string) => Promise<boolean>;
  setBounds: (bounds: BrowserBounds) => void;
  hide: () => void;
  navigate: (url: string) => Promise<boolean>;
  command: (name: "back" | "forward" | "reload" | "stop") => void;
  onState: (cb: (state: BrowserState) => void) => () => void;
}

/** The Electron bridge, or null outside the desktop app (e.g. `next dev` in a browser). */
export function getBrowserBridge(): BrowserBridge | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((window as any).marvenElectron?.browser as BrowserBridge | undefined) ?? null;
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
    return new URL(`http://${text}`).href;
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
