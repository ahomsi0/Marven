"use client";

import type { PromptTemplate } from "@/types";

export interface SlashCommand {
  command: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: "/clear", description: "Clear current conversation" },
  { command: "/new", description: "Start a new conversation" },
  { command: "/shortcuts", description: "Open shortcuts manager" },
  { command: "/help", description: "Show commands & tips" },
  { command: "/voice", description: 'Toggle "Hey Marven" wake word' },
  { command: "/speech", description: "Toggle text-to-speech" },
  { command: "/briefing", description: "Morning briefing — time, weather & news" },
];

export const AGENT_SLASH_COMMANDS: SlashCommand[] = [
  { command: "/clear", description: "Clear agent conversation" },
  { command: "/refresh", description: "Refresh workspace file list" },
  { command: "/help", description: "Show agent commands" },
];

interface SlashMenuProps {
  query: string;
  activeIndex: number;
  commands?: SlashCommand[];
  promptTemplates?: PromptTemplate[];
  onSelect: (command: string) => void;
  onSetActive: (index: number) => void;
}

export function SlashMenu({
  query,
  activeIndex,
  commands = SLASH_COMMANDS,
  promptTemplates = [],
  onSelect,
  onSetActive,
}: SlashMenuProps) {
  const matchedBuiltins = commands.filter((c) =>
    c.command.slice(1).startsWith(query)
  );
  const matchedTemplates = promptTemplates.filter((t) =>
    t.trigger.startsWith(query)
  );

  const totalMatches = matchedBuiltins.length + matchedTemplates.length;
  if (totalMatches === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-50 rounded-2xl border border-[#333] bg-[#1e1e1e] shadow-2xl overflow-hidden">
      <ul>
        {matchedBuiltins.map((item, i) => (
          <li
            key={item.command}
            onMouseEnter={() => onSetActive(i)}
            onClick={() => onSelect(item.command)}
            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
              i === activeIndex ? "bg-[#252525]" : "hover:bg-[#252525]/60"
            }`}
          >
            <code className={`text-[13px] font-mono min-w-[100px] ${i === activeIndex ? "text-[#d19a66]" : "text-[#ccc]"}`}>
              {item.command}
            </code>
            <span className="text-[12px] text-[#666]">{item.description}</span>
          </li>
        ))}

        {matchedBuiltins.length > 0 && matchedTemplates.length > 0 && (
          <li className="px-4 py-1 border-t border-[#2a2a2a]">
            <span className="text-[9px] uppercase tracking-widest text-[#444]">Templates</span>
          </li>
        )}

        {matchedTemplates.map((tmpl, j) => {
          const globalIdx = matchedBuiltins.length + j;
          return (
            <li
              key={tmpl.id}
              onMouseEnter={() => onSetActive(globalIdx)}
              onClick={() => onSelect(`/template:${tmpl.trigger}`)}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                globalIdx === activeIndex ? "bg-[#252525]" : "hover:bg-[#252525]/60"
              }`}
            >
              <code className={`text-[13px] font-mono min-w-[100px] ${globalIdx === activeIndex ? "text-[#d19a66]" : "text-[#ccc]"}`}>
                /{tmpl.trigger}
              </code>
              <span className="text-[12px] text-[#666]">
                {tmpl.label ?? tmpl.prompt.slice(0, 50)}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-[#2a2a2a] px-4 py-1.5 text-[10px] text-[#555] tracking-wide">
        ↑↓ navigate · Enter select · Esc cancel
      </div>
    </div>
  );
}
