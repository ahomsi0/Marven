"use client";

import { useState } from "react";
import { MarvenLogo } from "./MarvenLogo";

interface WorkspaceLandingProps {
  recentWorkspaces: string[];
  version?: string;
  onOpenFolder: () => void;
  onSelectRecent: (path: string) => void;
  onOpenSettings: () => void;
}

function homeRelative(absPath: string): { name: string; parent: string } {
  const segments = absPath.split("/").filter(Boolean);
  const name = segments[segments.length - 1] ?? absPath;
  // Show parent path with ~ shorthand (best-effort, client doesn't know $HOME)
  const parentSegments = segments.slice(0, -1);
  // Heuristic: if path starts with /Users/<x>, replace /Users/<x> with ~
  let parent = "/" + parentSegments.join("/");
  if (segments[0] === "Users" && segments.length >= 2) {
    parent = "~/" + segments.slice(2, -1).join("/");
  }
  return { name, parent };
}

export function WorkspaceLanding({
  recentWorkspaces,
  version,
  onOpenFolder,
  onSelectRecent,
  onOpenSettings,
}: WorkspaceLandingProps) {
  const [showCloneForm, setShowCloneForm] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [expandedRecents, setExpandedRecents] = useState(false);

  async function handleClone() {
    const url = cloneUrl.trim();
    if (!url) return;
    setCloning(true);
    setCloneError(null);
    try {
      const res = await fetch("/api/workspace/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok || !data.path) {
        setCloneError(data.error ?? "Clone failed");
        return;
      }
      setShowCloneForm(false);
      setCloneUrl("");
      onSelectRecent(data.path);
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err));
    } finally {
      setCloning(false);
    }
  }

  const displayedRecents = expandedRecents ? recentWorkspaces : recentWorkspaces.slice(0, 5);

  return (
    <div className="flex h-full min-h-0 flex-1 items-start justify-center overflow-y-auto bg-[#1a1a1a] px-8 py-20">
      <div className="w-full max-w-[760px]">
        {/* Brand */}
        <div className="mb-3 flex items-center gap-3">
          <MarvenLogo size={48} />
          <span className="font-mono text-[28px] font-semibold tracking-wide text-[#ddd]">MARVEN</span>
        </div>
        <div className="mb-12 text-[13px] text-[#666]">
          {version ? `Version ${version}` : "Local AI Desktop"} <span className="mx-1 text-[#333]">·</span>
          <span className="text-[#d19a66]">Wave 5</span>
        </div>

        {/* Action cards */}
        <div className="mb-10 grid grid-cols-3 gap-3">
          <ActionCard
            icon={
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25" />
              </svg>
            }
            label="Open project"
            onClick={onOpenFolder}
          />
          <ActionCard
            icon={
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            }
            label="Clone repo"
            onClick={() => { setShowCloneForm(true); setCloneError(null); }}
          />
          <ActionCard
            icon={
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
            label="Settings"
            onClick={onOpenSettings}
          />
        </div>

        {/* Clone form */}
        {showCloneForm && (
          <div className="mb-10 rounded-lg border border-[#333] bg-[#1e1e1e] p-3">
            <div className="mb-2 text-[11px] uppercase tracking-widest text-[#666]">Clone repository</div>
            <div className="flex gap-2">
              <input
                autoFocus
                type="text"
                value={cloneUrl}
                onChange={(e) => { setCloneUrl(e.target.value); setCloneError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleClone(); }
                  if (e.key === "Escape") { setShowCloneForm(false); setCloneUrl(""); setCloneError(null); }
                }}
                placeholder="https://github.com/user/repo.git"
                disabled={cloning}
                className="flex-1 rounded-md border border-[#383838] bg-[#252525] px-3 py-2 font-mono text-[12px] text-[#d4d4d4] outline-none focus:border-[#d19a66]/50 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleClone}
                disabled={cloning || !cloneUrl.trim()}
                className="rounded-md border border-[#d19a66]/30 bg-[#d19a66]/10 px-4 py-2 text-[11px] text-[#d19a66] hover:bg-[#d19a66]/20 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {cloning ? "Cloning…" : "Clone"}
              </button>
              <button
                type="button"
                onClick={() => { setShowCloneForm(false); setCloneUrl(""); setCloneError(null); }}
                disabled={cloning}
                className="rounded-md border border-[#383838] px-3 py-2 text-[11px] text-[#888] hover:text-[#ccc]"
              >
                Cancel
              </button>
            </div>
            {cloneError && (
              <p className="mt-2 font-mono text-[10px] text-red-400">{cloneError}</p>
            )}
            <p className="mt-2 text-[10px] text-[#555]">
              Clones into <code className="font-mono text-[10px] text-[#777]">~/Marven-Workspaces</code> by default.
            </p>
          </div>
        )}

        {/* Recent projects */}
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-[13px] text-[#888]">Recent projects</span>
            {recentWorkspaces.length > 5 && (
              <button
                type="button"
                onClick={() => setExpandedRecents((v) => !v)}
                className="text-[11px] text-[#d19a66] hover:text-[#e0b890]"
              >
                {expandedRecents ? "Show less" : `View all (${recentWorkspaces.length})`}
              </button>
            )}
          </div>
          {recentWorkspaces.length === 0 ? (
            <p className="text-[12px] text-[#555]">No recent projects yet — open one to get started.</p>
          ) : (
            <ul className="flex flex-col">
              {displayedRecents.map((p) => {
                const { name, parent } = homeRelative(p);
                return (
                  <li key={p}>
                    <button
                      type="button"
                      onClick={() => onSelectRecent(p)}
                      className="group flex w-full items-baseline justify-between gap-4 rounded-md px-3 py-2 text-left transition-colors hover:bg-[#252525]"
                    >
                      <span className="truncate text-[13px] text-[#d4d4d4] group-hover:text-[#d19a66]">{name}</span>
                      <span className="truncate font-mono text-[11px] text-[#555]">{parent}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionCard({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-3 rounded-lg border border-[#333] bg-[#1e1e1e] px-4 py-4 text-left transition-colors hover:border-[#d19a66]/40 hover:bg-[#252525]"
    >
      <span className="text-[#d19a66]">{icon}</span>
      <span className="text-[13px] text-[#d4d4d4]">{label}</span>
    </button>
  );
}
