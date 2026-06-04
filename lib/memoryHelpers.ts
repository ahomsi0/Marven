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
