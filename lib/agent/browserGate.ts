// Pure decisions the agent loop makes about browser tool calls before they
// leave for the main process. The page-dependent decisions (which host, does
// this submit a form, is the field sensitive) are made in electron/browser/agent.js.

import { containsSecret } from "@/lib/redact";
import { groqModelSupportsVision } from "@/lib/imageHelpers";
import type { AIProvider, BrowserToolName } from "@/types";
import { BROWSER_TOOL_DEFINITIONS } from "./browserTools";

const BROWSER_TOOLS = new Set<string>(BROWSER_TOOL_DEFINITIONS.map((t) => t.name));
const ACTING_TOOLS = new Set<string>(["browser_click", "browser_type", "browser_press", "browser_select"]);

export function isBrowserTool(name: string): name is BrowserToolName {
  return BROWSER_TOOLS.has(name);
}

/** Tools that change a page (and so need the user's approval per site). */
export function isActingBrowserTool(name: string): boolean {
  return ACTING_TOOLS.has(name);
}

/** A refusal message when the call would type or open a secret, else null. */
export function browserSecretRefusal(tool: string, args: Record<string, unknown>, knownSecrets: readonly string[]): string | null {
  const value = tool === "browser_type" ? args.text : tool === "browser_open" ? args.url : undefined;
  if (typeof value !== "string" || !containsSecret(value, knownSecrets)) return null;
  return "This looks like a secret (an API key or token). Don't put it into a web page; ask the user to enter it themselves if it's really needed.";
}

/**
 * Whether the agent adapter for this provider sends image attachments. The
 * Ollama, OpenRouter, NIM and local OpenAI-compatible agent adapters strip them.
 */
export function canSeeImages(provider: AIProvider, model: string): boolean {
  if (provider === "anthropic" || provider === "openai") return true;
  if (provider === "groq") return groqModelSupportsVision(model);
  return false;
}

/** Values of *_API_KEY / *_TOKEN variables, which the agent must never type. */
export function secretValuesFromEnv(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([name, value]) => /(_API_KEY|_TOKEN)$/.test(name) && typeof value === "string" && value.length >= 12)
    .map(([, value]) => value as string);
}
