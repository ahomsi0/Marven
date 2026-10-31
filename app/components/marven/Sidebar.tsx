"use client";

import { useState, useEffect, useRef } from "react";
import type { Conversation, ConversationFolder } from "@/types";
import { MarvenLogo } from "./MarvenLogo";
import { AccountBar } from "./AccountBar";
import { ChatBubbleIcon, CodeIcon, SidebarIcon } from "./Icons";
import { filterConversations } from "@/lib/chatHelpers";
import { useT } from "@/lib/i18n";
import type { TFunction } from "i18next";

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
  userName?: string;
  providerLabel?: string;
  appVersion?: string;
  folders: ConversationFolder[];
  onCreateFolder: () => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveConversation: (convId: string, folderId: string | null) => void;
  onCloseSidebar: () => void;
}

// Shared row styles — icon rows up top, plain-case section labels below.
const NAV_ROW =
  "flex w-full items-center gap-3 rounded-lg px-3 py-[7px] text-start text-[14px] text-[var(--m-text)] transition-colors hover:bg-[var(--m-surface-2)]";
const NAV_ICON = "h-[18px] w-[18px] shrink-0 text-[var(--m-text-muted)]";
const SECTION_LABEL = "mb-1 mt-2 px-3 text-[13px] font-medium text-[var(--m-text-muted)]";

// Open/close slide: an ease-out curve that starts quick and settles softly.
const SLIDE = "duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

function relativeDate(isoString: string, t: TFunction, locale: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t("sidebar.today");
  if (diffDays === 1) return t("sidebar.yesterday");
  if (diffDays < 7) return t("sidebar.daysAgo", { count: diffDays });
  if (diffDays < 30) return t("sidebar.weeksAgo", { count: Math.floor(diffDays / 7) });
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function groupConversations(
  conversations: Conversation[],
  t: TFunction,
  locale: string,
): { label: string; items: Conversation[] }[] {
  const groups: Record<string, Conversation[]> = {};
  for (const conv of [...conversations].reverse()) {
    const label = relativeDate(conv.updatedAt, t, locale);
    if (!groups[label]) groups[label] = [];
    groups[label].push(conv);
  }
  return Object.entries(groups).map(([label, items]) => ({ label, items }));
}

function ConvRow({
  conv,
  isActive,
  isDragging,
  onSelect,
  onDelete,
  onPin,
  onContextMenu,
  onDragStart,
  onDragEnd,
}: {
  conv: Conversation;
  isActive: boolean;
  isDragging?: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onPin: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}) {
  const { t } = useT();
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group relative flex w-full select-none items-center rounded-lg px-3 py-[7px] text-start text-[var(--m-text)] transition-colors ${
        isDragging
          ? "opacity-40"
          : isActive
          ? "bg-[var(--m-surface-3)]"
          : "hover:bg-[var(--m-surface-2)]"
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
        <span className="me-1.5 text-[#d19a66]/60">
          <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M16 2v11l2 2v2H6v-2l2-2V2h8zm-2 0H10v10.586L8 14.586V15h8v-.414L14 12.586V2z" />
            <path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2z" />
          </svg>
        </span>
      )}
      <span className="flex-1 truncate pe-9 text-[14px]">
        {conv.name || t("sidebar.untitled")}
      </span>
      {/* Pin button */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onPin(); }}
        aria-label={conv.pinned ? t("sidebar.unpinConversation") : t("sidebar.pinConversation")}
        title={conv.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
        className={`absolute end-6 top-1/2 -translate-y-1/2 rounded px-0.5 py-0.5 text-[11px] opacity-0 transition-opacity group-hover:opacity-100 ${
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
        aria-label={t("sidebar.deleteConversation")}
        className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded px-1 py-0.5 text-[11px] text-[var(--m-text-faint)] opacity-0 transition-opacity hover:text-red-500/80 group-hover:opacity-100"
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
  isDragOver,
  onToggle,
  onContextMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: {
  folder: ConversationFolder;
  isCollapsed: boolean;
  isRenaming: boolean;
  renameValue: string;
  isDragOver: boolean;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <div
        className={`group flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-3 py-[7px] text-[var(--m-text)] transition-colors ${
          isDragOver
            ? "outline outline-1 outline-[var(--m-accent)]/50 bg-[var(--m-accent-soft)]"
            : "hover:bg-[var(--m-surface-2)]"
        }`}
        onClick={onToggle}
        onContextMenu={onContextMenu}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {isRenaming ? (
          <input
            autoFocus
            className="flex-1 bg-transparent text-[14px] font-medium text-[var(--m-text)] outline-none"
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
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[14px] font-medium">{folder.name}</span>
            <svg
              className={`h-2.5 w-2.5 shrink-0 text-[var(--m-text-muted)] transition-transform ${isCollapsed ? "rtl:-scale-x-100" : "rotate-90"}`}
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        )}
      </div>
      {!isCollapsed && <div>{children}</div>}
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
  userName,
  providerLabel,
  appVersion,
  folders,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveConversation,
  onCloseSidebar,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  // Which list the sidebar shows: plain chats or agent sessions.
  const [view, setView] = useState<"chat" | "agent">("chat");
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Clip the content only while closed or sliding — once fully open the
  // account menu's flyouts need to extend past the sidebar's edge. `settledOpen`
  // is the state whose slide has finished, so a toggle clips in the same render
  // that starts the slide, and unclips when the width transition ends.
  const [settledOpen, setSettledOpen] = useState(isOpen);
  useEffect(() => {
    // No transition runs under reduced motion, so no transitionend will fire.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setSettledOpen(isOpen);
  }, [isOpen]);
  const { t, i18n } = useT();

  // Drag state: id of the conv being dragged, and which target is hovered.
  // "__unfiled__" means the unfiled drop zone.
  // draggingConvIdRef is the source of truth for drop handlers — it's set
  // synchronously so it's never null by the time drop fires, even if React
  // hasn't flushed the state update yet.
  const draggingConvIdRef = useRef<string | null>(null);
  const [draggingConvId, setDraggingConvId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

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

  // Follow the open conversation, so starting a new agent (or opening a chat)
  // switches the list to where that conversation lives.
  const activeMode = conversations.find((c) => c.id === activeConversationId)?.mode;
  useEffect(() => {
    if (activeMode) setView(activeMode === "agent" ? "agent" : "chat");
  }, [activeConversationId, activeMode]);

  const visibleConvs = conversations.filter((c) => (c.mode === "agent") === (view === "agent"));
  const pinnedConvs = visibleConvs.filter((c) => c.pinned);
  const unpinnedConvs = visibleConvs.filter((c) => !c.pinned);

  const isSearching = searchQuery.trim().length > 0;
  const searchResults = isSearching ? filterConversations(visibleConvs, searchQuery) : null;

  // The dragged conv — used to decide whether to show the unfiled drop zone.
  const draggingConv = draggingConvId ? conversations.find((c) => c.id === draggingConvId) : null;
  // Show the unfiled drop zone only when dragging a conv that's inside a folder.
  const showUnfiledDropZone = !!draggingConv?.folderId;

  function handleDragStart(e: React.DragEvent, convId: string) {
    e.dataTransfer.effectAllowed = "move";
    draggingConvIdRef.current = convId;
    // Delay the state update by one frame — setting state synchronously inside
    // onDragStart triggers an immediate re-render that can cause Chromium to
    // abort the drag before it fully starts.
    requestAnimationFrame(() => setDraggingConvId(convId));
  }

  function handleDragEnd() {
    draggingConvIdRef.current = null;
    setDraggingConvId(null);
    setDragOverTarget(null);
  }

  function handleFolderDragOver(e: React.DragEvent, folderId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTarget(folderId);
  }

  function handleFolderDragLeave(e: React.DragEvent, folderId: string) {
    // Only clear if we're actually leaving the element (not entering a child).
    const related = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(related)) {
      setDragOverTarget((prev) => (prev === folderId ? null : prev));
    }
  }

  function handleFolderDrop(e: React.DragEvent, folderId: string) {
    e.preventDefault();
    const convId = draggingConvIdRef.current;
    if (convId) onMoveConversation(convId, folderId);
    draggingConvIdRef.current = null;
    setDraggingConvId(null);
    setDragOverTarget(null);
  }

  function handleUnfiledDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTarget("__unfiled__");
  }

  function handleUnfiledDragLeave(e: React.DragEvent) {
    const related = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(related)) {
      setDragOverTarget((prev) => (prev === "__unfiled__" ? null : prev));
    }
  }

  function handleUnfiledDrop(e: React.DragEvent) {
    e.preventDefault();
    const convId = draggingConvIdRef.current;
    if (convId) onMoveConversation(convId, null);
    draggingConvIdRef.current = null;
    setDraggingConvId(null);
    setDragOverTarget(null);
  }

  return (
    <aside
      aria-hidden={!isOpen}
      inert={!isOpen}
      className={`h-full shrink-0 border-e bg-[var(--m-surface)] ${SLIDE} transition-[width,border-color] ${
        isOpen ? "w-[260px] border-[var(--m-border-subtle)]" : "w-0 border-transparent"
      } ${isOpen && settledOpen ? "overflow-visible" : "overflow-hidden"}`}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "width") setSettledOpen(isOpen);
      }}
    >
      {/* Fixed-width content: the panel's width animates over it, so nothing
          reflows mid-slide; it also fades and drifts toward the edge. */}
      <div
        className={`flex h-full w-[260px] flex-col ${SLIDE} transition-[opacity,translate] ${
          // "translate-none" (not translate-x-0) when open: any translate makes this
          // a containing block, which would offset the fixed-position context menu.
          isOpen ? "translate-none opacity-100" : "-translate-x-3 opacity-0 rtl:translate-x-3"
        }`}
      >
          {/* Brand */}
          <div className="flex h-12 shrink-0 items-center gap-2 px-3.5">
            <button
              type="button"
              onClick={onCloseSidebar}
              className="me-1 shrink-0 rounded-md p-1.5 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
              aria-label={t("sidebar.closeSidebar")}
              title={t("sidebar.closeSidebar")}
            >
              <SidebarIcon className="h-[18px] w-[18px] rtl:-scale-x-100" />
            </button>
            <MarvenLogo size={22} />
            <span className="text-[15px] font-semibold text-[var(--m-text)]">Marven</span>

            {/* Chats / agent sessions switcher */}
            <div
              role="group"
              aria-label={t("sidebar.showConversations")}
              className="ms-auto flex items-center gap-0.5 rounded-lg bg-[var(--m-surface-2)] p-0.5"
            >
              {([
                { id: "chat", label: t("sidebar.chats"), Icon: ChatBubbleIcon },
                { id: "agent", label: t("sidebar.agentSessions"), Icon: CodeIcon },
              ] as const).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setView(id)}
                  aria-pressed={view === id}
                  aria-label={label}
                  title={label}
                  className={`flex h-7 w-8 items-center justify-center rounded-md transition-colors ${
                    view === id
                      ? "bg-[var(--m-surface-3)] text-[var(--m-text)] shadow-sm ring-1 ring-[var(--m-border)]"
                      : "text-[var(--m-text-muted)] hover:text-[var(--m-text)]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          {/* Primary actions — icon rows, no borders */}
          <nav className="flex flex-col px-2 pb-2 pt-2">
            <button type="button" onClick={onNewChat} className={NAV_ROW}>
              <svg className={NAV_ICON} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3 21l1.4-5.2A8.5 8.5 0 1 1 21 12z" />
                <path d="M12 8.5v7M8.5 12h7" />
              </svg>
              {t("sidebar.newChat")}
            </button>
            <button type="button" onClick={onNewAgent} className={NAV_ROW}>
              <svg className={`${NAV_ICON} text-[var(--m-accent)]`} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5z" />
                <path d="M12 8v8M8 12h8" />
              </svg>
              {t("sidebar.newAgent")}
            </button>
            <label className={`${NAV_ROW} cursor-text focus-within:bg-[var(--m-surface-2)]`}>
              <svg className={NAV_ICON} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="text"
                placeholder={t("sidebar.search")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--m-text)] placeholder-[var(--m-text)] outline-none focus:placeholder-[var(--m-text-faint)]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label={t("sidebar.clearSearch")}
                  className="text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
                >
                  ×
                </button>
              )}
            </label>
          </nav>

          {/* Conversation list */}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1">
            {isSearching ? (
              /* ── Search results (flat) ── */
              searchResults!.length === 0 ? (
                <p className="px-3 py-2 text-[13px] text-[var(--m-text-faint)]">{t("sidebar.noResults")}</p>
              ) : (
                searchResults!.map((conv) => (
                  <ConvRow
                    key={conv.id}
                    conv={conv}
                    isActive={conv.id === activeConversationId}
                    isDragging={draggingConvId === conv.id}
                    onSelect={() => onSelectConversation(conv.id)}
                    onDelete={() => onDeleteConversation(conv.id)}
                    onPin={() => onPinConversation(conv.id, !conv.pinned)}
                    onContextMenu={(e) => { e.preventDefault(); setContextMenu({ kind: "conversation", convId: conv.id, x: e.clientX, y: e.clientY }); }}
                    onDragStart={(e) => handleDragStart(e, conv.id)}
                    onDragEnd={handleDragEnd}
                  />
                ))
              )
            ) : (
              /* ── Normal grouped view ── */
              <>
                {/* Pinned section */}
                {pinnedConvs.length > 0 && (
                  <div className="mb-3">
                    <p className={SECTION_LABEL}>{t("sidebar.pinned")}</p>
                    {pinnedConvs.map((conv) => (
                      <ConvRow
                        key={conv.id}
                        conv={conv}
                        isActive={conv.id === activeConversationId}
                        isDragging={draggingConvId === conv.id}
                        onSelect={() => onSelectConversation(conv.id)}
                        onDelete={() => onDeleteConversation(conv.id)}
                        onPin={() => onPinConversation(conv.id, false)}
                        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ kind: "conversation", convId: conv.id, x: e.clientX, y: e.clientY }); }}
                        onDragStart={(e) => handleDragStart(e, conv.id)}
                        onDragEnd={handleDragEnd}
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
                      isDragOver={dragOverTarget === folder.id}
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
                      onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                      onDragLeave={(e) => handleFolderDragLeave(e, folder.id)}
                      onDrop={(e) => handleFolderDrop(e, folder.id)}
                    >
                      {folderConvs.map((conv) => (
                        <ConvRow
                          key={conv.id}
                          conv={conv}
                          isActive={conv.id === activeConversationId}
                          isDragging={draggingConvId === conv.id}
                          onSelect={() => onSelectConversation(conv.id)}
                          onDelete={() => onDeleteConversation(conv.id)}
                          onPin={() => onPinConversation(conv.id, !conv.pinned)}
                          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ kind: "conversation", convId: conv.id, x: e.clientX, y: e.clientY }); }}
                          onDragStart={(e) => handleDragStart(e, conv.id)}
                          onDragEnd={handleDragEnd}
                        />
                      ))}
                      {folderConvs.length === 0 && !draggingConvId && (
                        <p className="px-3 py-1 text-[13px] text-[var(--m-text-faint)]">{t("sidebar.empty")}</p>
                      )}
                    </FolderRow>
                  );
                })}

                {/* "+ New folder" small button */}
                <button
                  type="button"
                  onClick={onCreateFolder}
                  className="mb-3 flex w-full items-center gap-1.5 rounded-lg px-3 py-[7px] text-[13px] text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  {t("sidebar.newFolder")}
                </button>

                {/* Unfiled drop zone — visible only while dragging a foldered conv */}
                {showUnfiledDropZone && (
                  <div
                    onDragOver={handleUnfiledDragOver}
                    onDragLeave={handleUnfiledDragLeave}
                    onDrop={handleUnfiledDrop}
                    className={`mb-2 rounded-md border border-dashed px-3 py-2 text-center text-[11px] transition-colors ${
                      dragOverTarget === "__unfiled__"
                        ? "border-[#d19a66]/60 bg-[#d19a66]/08 text-[#d19a66]"
                        : "border-[var(--m-border)] text-[var(--m-text-faint)]"
                    }`}
                  >
                    {t("sidebar.dropToUnfile")}
                  </div>
                )}

                {/* Unfiled date-grouped */}
                {(() => {
                  const unfiledConvs = unpinnedConvs.filter((c) => !c.folderId);
                  const unfiledGrouped = groupConversations(unfiledConvs, t, i18n.language);
                  return (
                    <>
                      {unfiledGrouped.length === 0 && pinnedConvs.length === 0 && folders.length === 0 && (
                        <p className="px-3 text-[13px] text-[var(--m-text-faint)]">
                          {view === "agent" ? t("sidebar.noAgentSessionsYet") : t("sidebar.noChatsYet")}
                        </p>
                      )}
                      {unfiledGrouped.map(({ label, items }) => (
                        <div key={label} className="mb-3">
                          <p className={SECTION_LABEL}>{label}</p>
                          {items.map((conv) => (
                            <ConvRow
                              key={conv.id}
                              conv={conv}
                              isActive={conv.id === activeConversationId}
                              isDragging={draggingConvId === conv.id}
                              onSelect={() => onSelectConversation(conv.id)}
                              onDelete={() => onDeleteConversation(conv.id)}
                              onPin={() => onPinConversation(conv.id, true)}
                              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ kind: "conversation", convId: conv.id, x: e.clientX, y: e.clientY }); }}
                              onDragStart={(e) => handleDragStart(e, conv.id)}
                              onDragEnd={handleDragEnd}
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
                  <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--m-text-faint)]">{t("sidebar.moveTo")}</p>
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-[12px] text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
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
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-[12px] text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
                        onClick={() => { onMoveConversation(contextMenu.convId, null); setContextMenu(null); }}
                      >
                        {t("sidebar.removeFromFolder")}
                      </button>
                    ) : null;
                  })()}
                  {folders.length === 0 && (
                    <p className="px-3 py-1.5 text-[11px] text-[var(--m-text-faint)]">{t("sidebar.noFoldersYet")}</p>
                  )}
                </>
              )}
              {contextMenu.kind === "folder" && (
                <>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-[12px] text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
                    onClick={() => {
                      const folder = folders.find((f) => f.id === contextMenu.folderId);
                      if (folder) { setRenamingFolderId(folder.id); setRenameValue(folder.name); }
                      setContextMenu(null);
                    }}
                  >
                    {t("sidebar.rename")}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-[12px] text-red-400/80 hover:bg-[var(--m-surface-2)] hover:text-red-400"
                    onClick={() => { onDeleteFolder(contextMenu.folderId); setContextMenu(null); }}
                  >
                    {t("sidebar.deleteFolder")}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Account + settings + glitch report at bottom */}
          <AccountBar
            userName={userName}
            providerLabel={providerLabel}
            appVersion={appVersion}
            onOpenSettings={onOpenSettings}
          />
      </div>
    </aside>
  );
}
