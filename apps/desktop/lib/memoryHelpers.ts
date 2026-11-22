type MemoryScope = "global" | "project" | "conversation";

export function buildScopedMemoryBlock(scopes: Record<MemoryScope, string[]>): string {
  const sections: string[] = [];
  if (scopes.global.length > 0) {
    sections.push(`Global memory:\n${scopes.global.map((m) => `- ${m}`).join("\n")}`);
  }
  if (scopes.project.length > 0) {
    sections.push(`Project memory:\n${scopes.project.map((m) => `- ${m}`).join("\n")}`);
  }
  if (scopes.conversation.length > 0) {
    sections.push(`Conversation memory:\n${scopes.conversation.map((m) => `- ${m}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

const REMEMBER_RE = /^(?:remember(?: that)?|don't forget(?: that)?)\s+(.+)$/i;

/**
 * "remember that I like tea" → "I like tea". Returns null when the text isn't
 * a remember command.
 */
export function parseRememberCommand(text: string): string | null {
  const memory = text.match(REMEMBER_RE)?.[1]?.trim();
  return memory ? memory : null;
}
