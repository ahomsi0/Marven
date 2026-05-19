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
