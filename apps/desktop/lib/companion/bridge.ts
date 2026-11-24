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
}

export interface CompanionSettings {
  speak: boolean;
  scale: 2 | 3 | 4;
  activity: Activity;
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
  personality: "playful",
  sleepMinutes: 5,
  wakeWord: false,
  projectsDir: "~/Marven Projects",
  look: null,
};

type Unsubscribe = () => void;

export interface CompanionBridge {
  getSettings(): Promise<CompanionSettings | null>;
  getPosition(): Promise<CompanionPosition | null>;
  setInteractive(on: boolean): void;
  setFocusable(on: boolean): void;
  walkTo(x: number): void;
  stop(): void;
  drag(dx: number, dy: number): void;
  drop(): void;
  returnHome(): void;
  /** Hand the thread to the main window: as a chat, or (agent) as a new Agent conversation with the last request pre-filled. */
  openInMarven(messages: CompanionMessage[], mode?: "agent" | "chat"): void;
  /** The clipboard's text, read by the main process (capped); "" when empty. */
  readClipboard(): Promise<string>;
  openSettings(): void;
  onPosition(cb: (p: CompanionPosition) => void): Unsubscribe;
  onOpenInput(cb: () => void): Unsubscribe;
  onListen(cb: () => void): Unsubscribe;
  onSettings(cb: (s: CompanionSettings) => void): Unsubscribe;
}

export function getCompanionBridge(): CompanionBridge | null {
  if (typeof window === "undefined") return null;
  const electron = (window as unknown as { marvenElectron?: { companion?: CompanionBridge } }).marvenElectron;
  return electron?.companion ?? null;
}
