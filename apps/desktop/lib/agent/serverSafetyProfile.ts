// Server-side source of truth for the agent safety profile.
//
// The renderer used to send its localStorage copy of `agentSafetyProfile` with
// every /api/agent/stream request, which meant any caller that could reach the
// local API could simply claim `"trusted"` and skip every approval prompt.
// The profile is actually persisted by the Electron main process in
// userData/settings.json — and because the Next.js server runs *inside* that
// process (production), it can read the same file and enforce the real value.
//
// When MARVEN_USER_DATA isn't set (plain `next dev` outside Electron), we fall
// back to the wire-supplied value to keep development workflows working.

import fs from "fs";
import path from "path";
import {
  normalizeAgentSafetyProfile,
  type AgentSafetyProfile,
} from "@/lib/agent/safety";

const VALID_PROFILES: AgentSafetyProfile[] = [
  "read-only",
  "ask-before-write",
  "ask-before-command",
  "trusted",
];

// Lower = more restrictive.
function permissiveness(profile: AgentSafetyProfile): number {
  return VALID_PROFILES.indexOf(profile);
}

export function isServerManagedSafetyProfile(): boolean {
  return Boolean(process.env.MARVEN_USER_DATA);
}

/** The profile persisted by the Electron main process, or null if unreadable. */
export function readPersistedAgentSafetyProfile(): AgentSafetyProfile | null {
  const userData = process.env.MARVEN_USER_DATA;
  if (!userData) return null;
  try {
    const raw = fs.readFileSync(path.join(userData, "settings.json"), "utf8");
    const parsed = JSON.parse(raw) as { agentSafetyProfile?: unknown };
    if (typeof parsed.agentSafetyProfile === "string") {
      const normalized = normalizeAgentSafetyProfile(parsed.agentSafetyProfile);
      // normalizeAgentSafetyProfile maps unknown values to the safe default —
      // accept that, but reject values that aren't part of the known ladder.
      if ((VALID_PROFILES as string[]).includes(normalized)) return normalized;
    }
  } catch {
    // Missing/corrupt settings file — fall through to null.
  }
  return null;
}
/**
 * Effective profile for a request: never more permissive than what's persisted
 * server-side. Without server persistence (dev mode), the requested profile
 * passes through unchanged.
 */
export function effectiveAgentSafetyProfile(
  requested: AgentSafetyProfile | undefined,
): AgentSafetyProfile {
  const wanted = normalizeAgentSafetyProfile(requested);
  const persisted = readPersistedAgentSafetyProfile();
  if (!persisted) return wanted;
  return permissiveness(wanted) <= permissiveness(persisted) ? wanted : persisted;
}
