import type { Conversation } from "@/types";

const PROVIDER_LABELS: Record<string, string> = {
  groq: "Groq",
  ollama: "Ollama",
  nim: "NIM",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/**
 * Filter conversations by name or message content.
 * Returns all conversations when query is empty.
 * Results are sorted by updatedAt descending.
 */
export function filterConversations(conversations: Conversation[], query: string): Conversation[] {
  const q = query.toLowerCase().trim();
  if (!q) return conversations;
  return conversations
    .filter(
      (conv) =>
        conv.name.toLowerCase().includes(q) ||
        conv.messages.some((m) => m.content.toLowerCase().includes(q))
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * Generate a markdown export string from a conversation.
 * Tool messages (role not user/assistant) are omitted.
 */
export function generateMarkdown(conversation: Conversation): string {
  const date = new Date().toLocaleDateString([], {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const providerLabel = conversation.provider ? (PROVIDER_LABELS[conversation.provider] ?? conversation.provider) : "";
  const modelLabel = conversation.model ?? "";
  const metaParts = [providerLabel, modelLabel].filter(Boolean).join(" · ");

  let md = `# ${conversation.name || "Untitled"}\n`;
  md += `_Exported ${date}${metaParts ? ` · ${metaParts}` : ""}_\n\n---\n\n`;

  const chatMessages = conversation.messages.filter((m) => m.role === "user" || m.role === "assistant");

  for (const msg of chatMessages) {
    const label = msg.role === "user" ? "**You:**" : "**Assistant:**";
    md += `${label} ${msg.content}\n\n---\n\n`;
  }

  return md;
}
