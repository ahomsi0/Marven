// lib/editor/lspClient.ts
import type {
  LspEnsureResult,
  LspNotification,
  LspOpenSessionOpts,
  LspStatusEvent,
} from "@/types";
import type { LanguageId } from "./lspServers";

type Bridge = {
  ensure: (id: string) => Promise<LspEnsureResult>;
  openSession: (o: LspOpenSessionOpts) => Promise<{ sessionId: string }>;
  closeSession: (id: string) => Promise<{ ok: true }>;
  didChange: (sessionId: string, payload: { version: number; text: string }) => void;
  request: (
    sessionId: string,
    method: string,
    params?: unknown
  ) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;
  restart: (id: string) => Promise<LspEnsureResult>;
  onNotification: (cb: (n: LspNotification) => void) => () => void;
  onStatus: (cb: (s: LspStatusEvent) => void) => () => void;
};

function getBridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { marvenElectron?: { lsp?: Bridge } };
  return w.marvenElectron?.lsp ?? null;
}

const NOT_AVAILABLE: LspEnsureResult = {
  status: "failed",
  error: "LSP bridge not available (running outside Electron)",
};

export interface LspClient {
  ensure(languageId: LanguageId): Promise<LspEnsureResult>;
  openSession(opts: LspOpenSessionOpts): Promise<{ sessionId: string }>;
  closeSession(sessionId: string): Promise<void>;
  didChange(sessionId: string, payload: { version: number; text: string }): void;
  request<T = unknown>(sessionId: string, method: string, params?: unknown): Promise<T>;
  restart(languageId: LanguageId): Promise<LspEnsureResult>;
  onNotification(handler: (n: LspNotification) => void): () => void;
  onStatus(handler: (s: LspStatusEvent) => void): () => void;
}

export const lspClient: LspClient = {
  async ensure(languageId) {
    const b = getBridge();
    if (!b) return NOT_AVAILABLE;
    return b.ensure(languageId);
  },
  async openSession(opts) {
    const b = getBridge();
    if (!b) throw new Error(NOT_AVAILABLE.error);
    return b.openSession(opts);
  },
  async closeSession(sessionId) {
    const b = getBridge();
    if (!b) return;
    await b.closeSession(sessionId);
  },
  didChange(sessionId, payload) {
    const b = getBridge();
    if (!b) return;
    b.didChange(sessionId, payload);
  },
  async request<T>(sessionId: string, method: string, params?: unknown): Promise<T> {
    const b = getBridge();
    if (!b) throw new Error(NOT_AVAILABLE.error);
    const r = await b.request(sessionId, method, params);
    if (!r.ok) throw new Error(r.error);
    return r.result as T;
  },
  async restart(languageId) {
    const b = getBridge();
    if (!b) return NOT_AVAILABLE;
    return b.restart(languageId);
  },
  onNotification(handler) {
    const b = getBridge();
    if (!b) return () => {};
    return b.onNotification(handler);
  },
  onStatus(handler) {
    const b = getBridge();
    if (!b) return () => {};
    return b.onStatus(handler);
  },
};
