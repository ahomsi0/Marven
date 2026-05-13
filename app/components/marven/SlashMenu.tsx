"use client";

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
  onSelect: (command: string) => void;
  onSetActive: (index: number) => void;
}

export function SlashMenu({ query, activeIndex, commands = SLASH_COMMANDS, onSelect, onSetActive }: SlashMenuProps) {
  const matches = commands.filter((c) =>
    c.command.slice(1).startsWith(query)
  );

  if (matches.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-50 rounded-2xl border border-[#333] bg-[#1e1e1e] shadow-2xl overflow-hidden">
      <ul>
        {matches.map((item, i) => (
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
      </ul>
      <div className="border-t border-[#2a2a2a] px-4 py-1.5 text-[10px] text-[#555] tracking-wide">
        ↑↓ navigate · Enter select · Esc cancel
      </div>
    </div>
  );
}
