// Typed access to the companion half of the preload bridge (electron/preload.js).

import type { CompanionMessage } from "./brain";
import type { Strip } from "./behaviour";

export interface CompanionPosition {
  x: number;
  y: number;
  facing: 1 | -1;
  walking: boolean;
  inDock: boolean;
  strip: Strip;
  arrived?: boolean;
}

export interface CompanionSettings {
  speak: boolean;
  scale: 2 | 3 | 4;
  walk: boolean;
  sleepMinutes: number;
  wakeWord: boolean;
}

export const DEFAULT_COMPANION_SETTINGS: CompanionSettings = {
  speak: true,
  scale: 3,
  walk: true,
  sleepMinutes: 5,
  wakeWord: false,
};

type Unsubscribe = () => void;

export interface CompanionBridge {
  getSettings(): Promise<CompanionSettings | null>;
  setInteractive(on: boolean): void;
  setFocusable(on: boolean): void;
  walkTo(x: number): void;
  stop(): void;
  drag(dx: number, dy: number): void;
  drop(): void;
  returnHome(): void;
  openInMarven(messages: CompanionMessage[]): void;
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
