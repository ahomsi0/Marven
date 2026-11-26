// Typed access to the companion half of the preload bridge (electron/companionPreload.js).

import type { CompanionMessage, Personality } from "./brain";
import type { Activity, Strip } from "./behaviour";

export interface CompanionPosition {
  x: number;
  y: number;
  facing: 1 | -1;
  walking: boolean;
  inDock: boolean;
  strip: Strip;
  arrived?: boolean;
  /** Sent once after a drag ends, with the final dock state. */
  dropped?: boolean;
  /** With `dropped`: the main process is dropping him to the Dock; `arrived` follows when he lands. */
  falling?: boolean;
}

export interface CompanionSettings {
  speak: boolean;
  scale: 2 | 3 | 4;
  activity: Activity;
  /** Dropped away from the Dock: stay perched there, or fall back to the Dock. */
  drop: "stay" | "dock";
  personality: Personality;
  sleepMinutes: number;
  wakeWord: boolean;
  /** Where new projects are created (a leading ~ is the home folder). */
  projectsDir: string;
  /** The saved appearance (unvalidated; run it through parseLook), or null for the default. */
  look: unknown | null;
}

export const DEFAULT_COMPANION_SETTINGS: CompanionSettings = {
  speak: true,
  scale: 3,
  activity: "lively",
  drop: "stay",
  personality: "playful",
  sleepMinutes: 5,
  wakeWord: false,
  projectsDir: "~/Marven Projects",
  look: null,
};

export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Settings pages Mini Me may open: AI keys, General (the Agent's safety profile), Mini Me. */
export type CompanionSettingsPage = "keys-ai" | "general" | "mini-me";

type Unsubscribe = () => void;

export interface CompanionBridge {
  getSettings(): Promise<CompanionSettings | null>;
  getPosition(): Promise<CompanionPosition | null>;
  setInteractive(on: boolean): void;
  /**
   * Linux only: the `[data-hit]` rects in window (CSS pixel) coordinates. The
   * window is shaped to them (padded), so clicks elsewhere fall through.
   */
  setHitRects(rects: HitRect[]): void;
  setFocusable(on: boolean): void;
  walkTo(x: number): void;
  stop(): void;
  drag(dx: number, dy: number): void;
  drop(): void;
  returnHome(): void;
  /**
   * Hand the thread to the main window: as a chat, or (agent) as a new Agent
   * conversation with the last request pre-filled. With `workspaceRoot` (a
   * project Mini Me built; main checks it is inside the projects folder) the
   * Agent conversation opens on that folder with the thread loaded instead;
   * with `autostart` too, the request is sent straight away (main refuses an
   * autostart unless the folder is a fresh project folder). Without autostart,
   * Marven reuses the Agent conversation already on that folder and adds the
   * messages (by id) it doesn't have. Resolves ok only
   * once Marven's window has received and accepted it.
   */
  openInMarven(
    messages: CompanionMessage[],
    mode?: "agent" | "chat",
    options?: { workspaceRoot?: string; autostart?: boolean },
  ): Promise<HandOffResult>;
  /** Open a folder or file inside the projects folder (main refuses anything else); resolves to "" or an error. */
  openPath(target: string): Promise<string>;
  /** Open a dev server address on this machine in the default browser (main refuses anything else). */
  openUrl(url: string): Promise<boolean>;
  /** Show a project folder (inside the projects folder) in the preview window, served on 127.0.0.1; resolves to its address, or null. */
  showPreview(root: string, name: string): Promise<string | null>;
  /** The project's files changed: the preview window (if open) reloads. */
  previewReload(): void;
  /** Where the speech bubble is in this window (the preview docks beside it); null when it closed, which closes the preview too. */
  setBubbleRect(rect: { x: number; y: number; width: number; height: number } | null): void;
  /** The preview closed (its own ×, or with the bubble). */
  onPreviewClosed(cb: () => void): Unsubscribe;
  /** The preview window's "Open in Marven" was pressed for this project folder. */
  onPreviewOpenInMarven(cb: (root: string) => void): Unsubscribe;
  /** The clipboard's text, read by the main process (capped); "" when empty. */
  readClipboard(): Promise<string>;
  /** Open Marven's Settings on one of the pages Mini Me may point to (main checks it; default "keys-ai"). */
  openSettings(page?: CompanionSettingsPage): void;
  onPosition(cb: (p: CompanionPosition) => void): Unsubscribe;
  onOpenInput(cb: () => void): Unsubscribe;
  onListen(cb: () => void): Unsubscribe;
  onSettings(cb: (s: CompanionSettings) => void): Unsubscribe;
}

/**
 * How an "Open in Marven" hand-off went. "busy": Marven's Agent is running (or
 * another hand-off is waiting); "refused": main's checks said no; "timeout" /
 * "unavailable": the main window didn't answer or wasn't ready; "invalid": the
 * main window couldn't use the thread.
 */
export interface HandOffResult {
  ok: boolean;
  reason?: "busy" | "refused" | "timeout" | "unavailable" | "invalid";
}

export function getCompanionBridge(): CompanionBridge | null {
  if (typeof window === "undefined") return null;
  const electron = (window as unknown as { marvenElectron?: { companion?: CompanionBridge } }).marvenElectron;
  return electron?.companion ?? null;
}

/** The OS the companion window runs on ("darwin", "win32", "linux"), or null outside Electron. */
export function getCompanionPlatform(): string | null {
  if (typeof window === "undefined") return null;
  const platform = (window as unknown as { marvenElectron?: { platform?: unknown } }).marvenElectron?.platform;
  return typeof platform === "string" ? platform : null;
}
