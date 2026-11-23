// Marven's base system prompt, shared by the main chat and Mini Me.

import { buildScopedMemoryBlock } from "@/lib/memoryHelpers";

export type ScopedMemories = {
  global: string[];
  project: string[];
  conversation: string[];
  legacy: string[];
};

export function buildMemoryContext(memories: ScopedMemories): string {
  const block = buildScopedMemoryBlock({
    global: [...memories.global, ...memories.legacy],
    project: memories.project,
    conversation: memories.conversation,
  });
  return block.trim();
}

export function buildSystemPrompt(
  name: string | null,
  memories: ScopedMemories,
  now: Date = new Date(),
): string {
  const dateStr = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  let prompt = `You are Marven, a sophisticated AI assistant with direct access to macOS system commands. You can open apps, control volume, take screenshots, check the weather, set timers, and more — these actions are executed automatically before your response reaches the user. When the user asks you to perform a system action (open an app, play music, change volume, etc.), respond briefly confirming the action, e.g. "Opening Spotify now." or "Volume increased." Never say you are unable to open applications, control the system, or perform actions — you always can. Never call yourself a "text-based AI". You are intelligent, precise, and occasionally witty. Keep answers concise.`;
  prompt += `\n\nCurrent date and time: ${dateStr}, ${timeStr}. Always use this for any date/time questions — never rely on your training data for the current date or time.`;
  if (name) prompt += `\n\nThe user's name is ${name}. Address them by name occasionally.`;
  const memoryBlock = buildMemoryContext(memories);
  if (memoryBlock) prompt += `\n\n${memoryBlock}`;
  return prompt;
}
