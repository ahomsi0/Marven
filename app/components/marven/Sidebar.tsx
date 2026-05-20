"use client";

import { useState, useEffect, useRef } from "react";
import type { Conversation, ConversationFolder } from "@/types";
import { MarvenLogo } from "./MarvenLogo";
import { filterConversations } from "@/lib/chatHelpers";

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  isOpen: boolean;
  onNewChat: () => void;
  onNewAgent: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onPinConversation: (id: string, pinned: boolean) => void;
  onOpenSettings: () => void;
  folders: ConversationFolder[];
  onCreateFolder: () => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveConversation: (convId: string, folderId: string | null) => void;
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

function ConvRow({
  conv,
  isActive,
  onSelect,
  onDelete,
  onPin,
  onContextMenu,
}: {
  conv: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onPin: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    // role=button + keyboard handler instead of a real <button>, because the
    // pin/delete actions inside need to be their own buttons and HTML doesn't
    // allow <button> inside <button> (hydration error).
    <div
      role="button"
      tabIndex={0}
      className={`group relative flex w-full cursor-pointer items-center rounded-md px-2 py-1.5 text-left transition-colors ${
        isActive
          ? "bg-[var(--m-surface-3)] text-[var(--m-text)]"
          : "text-[var(--m-text-muted)] hover:text-[var(--m-text)] hover:bg-[var(--m-surface-2)]"
      }`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {conv.pinned && (
        <span className="mr-1.5 text-[#d19a66]/60">
          <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M16 2v11l2 2v2H6v-2l2-2V2h8zm-2 0H10v10.586L8 14.586V15h8v-.414L14 12.586V2z" />
            <path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2z" />
          </svg>
        </span>
      )}
      <span className="flex-1 truncate pr-9 text-[13px]">
        {conv.name || "Untitled"}
      </span>
      {conv.mode === "agent" && (
        <span className="mr-1 rounded-full border border-[#d19a66]/20 bg-[#d19a66]/08 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-[#d19a66] transition-transform duration-150 group-hover:-translate-x-9">
          Agent
        </span>
      )}

      {/* Pin button — shown on hover */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onPin(); }}
        aria-label={conv.pinned ? "Unpin conversation" : "Pin conversation"}
        title={conv.pinned ? "Unpin" : "Pin"}
        className={`absolute right-6 top-1/2 -translate-y-1/2 rounded px-0.5 py-0.5 text-[11px] opacity-0 transition-opacity group-hover:opacity-100 ${
          conv.pinned ? "text-[#d19a66]/70 hover:text-[#d19a66]" : "text-[#555] hover:text-[#888]"
        }`}
      >
        <svg className="h-3 w-3" fill={conv.pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5z" />
        </svg>
      </button>

      {/* Delete button */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        aria-label="Delete conversation"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 py-0.5 text-[11px] text-[var(--m-text-faint)] opacity-0 transition-opacity hover:text-red-500/80 group-hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

function FolderRow({
  folder,
  isCollapsed,
  isRenaming,
  renameValue,
  onToggle,
  onContextMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  children,
}: {
  folder: ConversationFolder;
  isCollapsed: boolean;
  isRenaming: boolean;
  renameValue: string;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <div
        className="group flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
        onClick={onToggle}
        onContextMenu={onContextMenu}
      >
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
        </svg>
        <svg className="h-3 w-3 shrink-0 text-[#d19a66]/60" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v8.25A2.25 2.25 0 0 0 4.5 16.5h15a2.25 2.25 0 0 0 2.25-2.25V10.5a2.25 2.25 0 0 0-2.25-2.25H17.69Z" />
        </svg>
        {isRenaming ? (
          <input
            autoFocus
            className="flex-1 bg-transparent text-[12px] text-[var(--m-text)] outline-none"
            value={renameValue}
            onChange={onRenameChange}
            onBlur={onRenameCommit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") onRenameCommit();
              if (e.key === "Escape") onRenameCancel();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 truncate text-[12px]">{folder.name}</span>
        )}
      </div>
      {!isCollapsed && <div className="pl-3">{children}</div>}
    </div>
  );
}

type ContextMenuState =
  | { kind: "conversation"; convId: string; x: number; y: number }
  | { kind: "folder"; folderId: string; x: number; y: number }
  | null;

export function Sidebar({
  conversations,
  activeConversationId,
  isOpen,
  onNewChat,
  onNewAgent,
  onSelectConversation,
  onDeleteConversation,
  onPinConversation,
  onOpenSettings,
  folders,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveConversation,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function handleOutside(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [contextMenu]);

  const pinnedConvs = conversations.filter((c) => c.pinned);
  const unpinnedConvs = conversations.filter((c) => !c.pinned);

  const isSearching = searchQuery.trim().length > 0;
  const searchResults = isSearching ? filterConversations(conversations, searchQuery) : null;

  return (
    <aside
      className={`flex h-full flex-col bg-[var(--m-bg)] border-r border-[var(--m-border)] transition-all duration-200 ${
        isOpen ? "w-[220px] min-w-[220px]" : "w-0 min-w-0 overflow-hidden"
      }`}
    >
      {isOpen && (
        <>
          {/* Brand */}
          <div className="flex flex-col px-4 pb-3 pt-5">
            <div className="flex items-center gap-2">
              <MarvenLogo size={28} />
              <span className="text-[15px] font-semibold text-[var(--m-text)]">
                Marven
              </span>
            </div>
            <span className="mt-0.5 text-[11px] text-[var(--m-text-faint)]">
              assistant + agent
            </span>
          </div>

          <div className="mx-3 mb-3 h-px bg-[var(--m-border-subtle)]" />

          {/* New chat */}
          <button
            type="button"
            onClick={onNewChat}
            className="mx-3 mb-2 border border-[var(--m-border)] text-[var(--m-text-muted)] rounded-lg px-3 py-1.5 text-[12px] hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)] hover:bg-[var(--m-surface-2)] transition-all"
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

          {/* Search */}
          <div className="mx-3 mb-2">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--m-text-faint)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
              </svg>
              <input
                type="text"
                placeholder="Search…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-[var(--m-border-subtle)] bg-[var(--m-bg)] py-1.5 pl-7 pr-3 text-[11px] text-[var(--m-text-muted)] placeholder-[var(--m-text-faint)] outline-none focus:border-[var(--m-border)] focus:text-[var(--m-text)]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--m-border)] hover:text-[var(--m-text-muted)]"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Conversation list */}
          <div className="min-h-0 flex-1 overflow-y-auto px-2">
            {isSearching ? (
              /* ── Search results (flat) ── */
              searchResults!.length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-[var(--m-text-faint)]">No results</p>
              ) : (
                searchResults!.map((conv) => (
                  <ConvRow
                    key={conv.id}
                    conv={conv}
                    isActive={conv.id === activeConversationId}
                    onSelect={() => onSelectConversation(conv.id)}
                    onDelete={() => onDeleteConversation(conv.id)}
                    onPin={() => onPinConversation(conv.id, !conv.pinned)}
                    onContextMenu={(e) => { e.preventDefault(); setContextMenu({ kind: "conversation", convId: conv.id, x: e.clientX, y: e.clientY }); }}
                  />
                ))
              )
            ) : (
              /* ── Normal grouped view ── */
              <>
                {/* Pinned section */}
                {pinnedConvs.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1 px-2 text-[10px] uppercase tracking-wider font-medium text-[var(--m-text-faint)]">
                      Pinned
                    </p>
                    {pinnedConvs.map((conv) => (
                      <ConvRow
                        key={conv.id}
                        conv={conv}
                        isActive={conv.id === activeConversationId}
                        onSelect={() => onSelectConversation(conv.id)}
                        onDelete={() => onDeleteConversation(conv.id)}
                        onPin={() => onPinConversation(conv.id, false)}
                        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ kind: "conversation", convId: conv.id, x: e.clientX, y: e.clientY }); }}
                      />
                    ))}
                  </div>
                )}

                {/* Folders */}
                {folders.map((folder) => {
                  const folderConvs = unpinnedConvs.filter((c) => c.folderId === folder.id);
                  const isCollapsed = collapsedFolders.has(folder.id);
                  return (
                    <FolderRow
                      key={folder.id}
                      folder={folder}
                      isCollapsed={isCollapsed}
                      isRenaming={renamingFolderId === folder.id}
                      renameValue={renameValue}
                      onToggle={() =>
                        setCollapsedFolders((prev) => {
                          const next = new Set(prev);
                          if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id);
                          return next;
                        })
                      }
                      onContextMenu={(e) => { e.preventDefault(); setContextMenu({ kind: "folder", folderId: folder.id, x: e.clientX, y: e.clientY }); }}
                      onRenameChange={(e) => setRenameValue(e.target.value)}
                      onRenameCommit={() => { onRenameFolder(folder.id, renameValue); setRenamingFolderId(null); }}
                      onRenameCancel={() => setRenamingFolderId(null)}
                    >
                      {folderConvs.map((conv) => (
                        <ConvRow
                          key={conv.id}
                          conv={conv}
                          isActive={conv.id === activeConversationId}
                          onSelect={() => onSelectConversation(conv.id)}
                          onDelete={() => onDeleteConversation(conv.id)}
                          onPin={() => onPinConversation(conv.id, !conv.pinned)}
                          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ kind: "conversation", convId: conv.id, x: e.clientX, y: e.clientY }); }}
                        />
                      ))}
                      {folderConvs.length === 0 && (
                        <p className="px-2 py-1 text-[11px] text-[var(--m-text-faint)]">Empty</p>
                      )}
                    </FolderRow>
                  );
                })}
                {/* "+ New folder" small button */}
                <button
                  type="button"
                  onClick={onCreateFolder}
                  className="mb-2 mt-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)]"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New folder
                </button>

                {/* Unfiled date-grouped */}
                {(() => {
                  const unfiledConvs = unpinnedConvs.filter((c) => !c.folderId);
                  const unfiledGrouped = groupConversations(unfiledConvs);
                  return (
                    <>
                      {unfiledGrouped.length === 0 && pinnedConvs.length === 0 && folders.length === 0 && (
                        <p className="px-2 text-[12px] text-[var(--m-text-faint)]">No conversations yet</p>
                      )}
                      {unfiledGrouped.map(({ label, items }) => (
                        <div key={label} className="mb-3">
                          <p className="mb-1 px-2 text-[10px] uppercase tracking-wider font-medium text-[var(--m-text-faint)]">{label}</p>
                          {items.map((conv) => (
                            <ConvRow
                              key={conv.id}
                              conv={conv}
                              isActive={conv.id === activeConversationId}
                              onSelect={() => onSelectConversation(conv.id)}
                              onDelete={() => onDeleteConversation(conv.id)}
                              onPin={() => onPinConversation(conv.id, true)}
                              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ kind: "conversation", convId: conv.id, x: e.clientX, y: e.clientY }); }}
                            />
                          ))}
                        </div>
                      ))}
                    </>
                  );
                })()}
              </>
            )}
          </div>

          {/* Context menu */}
          {contextMenu && (
            <div
              ref={contextMenuRef}
              className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] py-1 shadow-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              {contextMenu.kind === "conversation" && (
                <>
                  <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--m-text-faint)]">Move to</p>
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
                      onClick={() => { onMoveConversation(contextMenu.convId, folder.id); setContextMenu(null); }}
                    >
                      {folder.name}
                    </button>
                  ))}
                  {(() => {
                    const conv = conversations.find((c) => c.id === contextMenu.convId);
                    return conv?.folderId ? (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
                        onClick={() => { onMoveConversation(contextMenu.convId, null); setContextMenu(null); }}
                      >
                        Remove from folder
                      </button>
                    ) : null;
                  })()}
                  {folders.length === 0 && (
                    <p className="px-3 py-1.5 text-[11px] text-[var(--m-text-faint)]">No folders yet</p>
                  )}
                </>
              )}
              {contextMenu.kind === "folder" && (
                <>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
                    onClick={() => {
                      const folder = folders.find((f) => f.id === contextMenu.folderId);
                      if (folder) { setRenamingFolderId(folder.id); setRenameValue(folder.name); }
                      setContextMenu(null);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-400/80 hover:bg-[var(--m-surface-2)] hover:text-red-400"
                    onClick={() => { onDeleteFolder(contextMenu.folderId); setContextMenu(null); }}
                  >
                    Delete folder
                  </button>
                </>
              )}
            </div>
          )}

          {/* Settings gear at bottom */}
          <div className="border-t border-[var(--m-border-subtle)] px-3 py-3">
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12px] text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text-muted)]"
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
