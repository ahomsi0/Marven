// lib/agentSettings.ts
"use client";

const WRITE_APPROVAL_KEY = "agentRequireWriteApproval";

export function getRequireWriteApproval(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(WRITE_APPROVAL_KEY) === "true";
}

export function setRequireWriteApproval(value: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(WRITE_APPROVAL_KEY, value ? "true" : "false");
}

const PLAN_MODE_KEY = "agentPlanMode";

export function getPlanMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(PLAN_MODE_KEY) === "true";
}

export function setPlanMode(value: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PLAN_MODE_KEY, value ? "true" : "false");
}

const BROWSING_KEY = "agentBrowsing";

/** Settings → General → "Let the agent use the browser". Off by default. */
export function getAgentBrowsing(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(BROWSING_KEY) === "true";
}

export function setAgentBrowsing(value: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(BROWSING_KEY, value ? "true" : "false");
}
