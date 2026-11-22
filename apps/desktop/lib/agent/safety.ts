export type AgentSafetyProfile = "read-only" | "ask-before-write" | "ask-before-command" | "trusted";

export const DEFAULT_AGENT_SAFETY_PROFILE: AgentSafetyProfile = "ask-before-write";

export function normalizeAgentSafetyProfile(value: unknown): AgentSafetyProfile {
  return value === "read-only" || value === "ask-before-write" || value === "ask-before-command" || value === "trusted"
    ? value
    : DEFAULT_AGENT_SAFETY_PROFILE;
}
