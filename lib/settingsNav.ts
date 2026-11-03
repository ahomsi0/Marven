"use client";

// Window events for jumping to a Settings page from anywhere in the app.
//
//   marven:report-problem   (no detail)
//     Opens Settings → About with the "Report a problem" panel open. Dispatch it
//     from anywhere (e.g. the command palette):
//       window.dispatchEvent(new CustomEvent("marven:report-problem"));
//
//   marven:open-settings    detail: SettingsRequest
//     Switches an open Settings view to `page`. Fired by openSettingsPage();
//     a mounted SettingsModal listens for it. If no Settings view is mounted,
//     <GlobalPanels> shows the requested panel as a standalone dialog instead
//     (Settings' open state lives in ChatLayout / the agent tab bar). A
//     Settings host that wants to open itself can listen for this event too:
//     the request is also kept as "pending" and a SettingsModal mounted within
//     the next moment picks it up.

export const REPORT_PROBLEM_EVENT = "marven:report-problem";
export const OPEN_SETTINGS_EVENT = "marven:open-settings";

/** Every Settings page, in nav order. */
export const SETTINGS_PAGES = [
  "general",
  "memory",
  "ai-backends",
  "keys-ai",
  "keys-voice",
  "connectors",
  "browser",
  "shortcuts",
  "keyboard",
  "templates",
  "commands",
  "about",
] as const;

export type SettingsRequestPage = (typeof SETTINGS_PAGES)[number];

export interface SettingsRequest {
  page: SettingsRequestPage;
  /** Open the "Report a problem" panel (About page). */
  reportProblem?: boolean;
  /** Workspace whose project memory to show (Memory page). */
  workspaceRoot?: string | null;
}

let mounted = 0;
let pending: { request: SettingsRequest; at: number } | null = null;
const PENDING_TTL_MS = 2000;

/** Called by SettingsModal while it is mounted; returns the unregister function. */
export function registerSettingsMount(): () => void {
  mounted += 1;
  return () => {
    mounted = Math.max(0, mounted - 1);
  };
}

export function isSettingsMounted(): boolean {
  return mounted > 0;
}

/** A request made in the last couple of seconds that no Settings view has handled yet. */
export function takePendingSettingsRequest(): SettingsRequest | null {
  const p = pending;
  pending = null;
  if (!p || Date.now() - p.at > PENDING_TTL_MS) return null;
  return p.request;
}

export function clearPendingSettingsRequest(): void {
  pending = null;
}

/** Ask the app to show a Settings page (see the event notes above). */
export function openSettingsPage(request: SettingsRequest): void {
  if (typeof window === "undefined") return;
  pending = { request, at: Date.now() };
  window.dispatchEvent(new CustomEvent<SettingsRequest>(OPEN_SETTINGS_EVENT, { detail: request }));
}
