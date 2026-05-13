"use client";

import type { Conversation } from "@/types";
import { MarvenLogo } from "./MarvenLogo";

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  isOpen: boolean;
  onNewChat: () => void;
  onNewAgent: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onOpenSettings: () => void;
}

function relativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Group conversations by relative date label */
function groupConversations(
  conversations: Conversation[]
): { label: string; items: Conversation[] }[] {
  const groups: Record<string, Conversation[]> = {};
  for (const conv of [...conversations].reverse()) {
    const label = relativeDate(conv.updatedAt);
    if (!groups[label]) groups[label] = [];
    groups[label].push(conv);
  }
  return Object.entries(groups).map(([label, items]) => ({ label, items }));
}

export function Sidebar({
  conversations,
  activeConversationId,
  isOpen,
  onNewChat,
  onNewAgent,
  onSelectConversation,
  onDeleteConversation,
  onOpenSettings,
}: SidebarProps) {
  const grouped = groupConversations(conversations);

  return (
    <aside
      className={`flex h-full flex-col bg-[#1a1a1a] border-r border-[#333] transition-all duration-200 ${
        isOpen ? "w-[220px] min-w-[220px]" : "w-0 min-w-0 overflow-hidden"
      }`}
    >
      {isOpen && (
        <>
          {/* Brand */}
          <div className="flex flex-col px-4 pb-3 pt-5">
            <div className="flex items-center gap-2">
              <MarvenLogo size={28} />
              <span className="text-[15px] font-semibold text-[#d4d4d4]">
                Marven
              </span>
            </div>
            <span className="mt-0.5 text-[11px] text-[#555]">
              assistant + agent
            </span>
          </div>

          <div className="mx-3 mb-3 h-px bg-[#2a2a2a]" />

          {/* New chat */}
          <button
            type="button"
            onClick={onNewChat}
            className="mx-3 mb-3 border border-[#383838] text-[#888] rounded-lg px-3 py-1.5 text-[12px] hover:border-[#555] hover:text-[#d4d4d4] hover:bg-[#252525] transition-all"
          >
            + New chat
          </button>
          <button
            type="button"
            onClick={onNewAgent}
            className="mx-3 mb-3 border border-[#d19a66]/25 bg-[#d19a66]/08 text-[#d19a66] rounded-lg px-3 py-1.5 text-[12px] hover:border-[#d19a66]/40 hover:bg-[#d19a66]/12 transition-all"
          >
            + New agent
          </button>

          {/* Conversation list */}
          <div className="min-h-0 flex-1 overflow-y-auto px-2">
            {grouped.length === 0 && (
              <p className="px-2 text-[12px] text-[#555]">
                No conversations yet
              </p>
            )}
            {grouped.map(({ label, items }) => (
              <div key={label} className="mb-3">
                <p className="mb-1 px-2 text-[10px] uppercase tracking-wider font-medium text-[#555]">
                  {label}
                </p>
                {items.map((conv) => (
                  <div
                    key={conv.id}
                    className={`group relative flex cursor-pointer items-center rounded-md px-2 py-1.5 transition-colors ${
                      conv.id === activeConversationId
                        ? "bg-[#2a2a2a] text-[#d4d4d4]"
                        : "text-[#888] hover:text-[#ccc] hover:bg-[#252525]"
                    }`}
                    onClick={() => onSelectConversation(conv.id)}
                  >
                    <span className="flex-1 truncate pr-5 text-[13px]">
                      {conv.name || "Untitled"}
                    </span>
                    {conv.mode === "agent" && (
                      <span className="mr-5 rounded-full border border-[#d19a66]/20 bg-[#d19a66]/08 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-[#d19a66]">
                        Agent
                      </span>
                    )}

                    {/* Delete button — only on hover */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteConversation(conv.id);
                      }}
                      aria-label="Delete conversation"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 py-0.5 text-[11px] text-[#666] opacity-0 transition-opacity hover:text-red-500/80 group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Settings gear at bottom */}
          <div className="border-t border-[#2a2a2a] px-3 py-3">
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12px] text-[#666] transition-colors hover:bg-[#252525] hover:text-[#999]"
            >
              <svg
                className="h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                />
              </svg>
              Settings
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
