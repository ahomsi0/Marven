"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  addMemoryEntry,
  clearMemoryScope,
  deleteMemoryEntry,
  editMemoryEntry,
  fetchMemoryEntries,
  type MemoryEntriesByScope,
} from "@/lib/memoryApi";
import { MEMORY_CHANGED_EVENT, MEMORY_SAVED_EVENT } from "@/lib/memoryEvents";
import {
  memoryExportFileName,
  memoryExportMarkdown,
  relativeMemoryDate,
  type MemoryViewEntry,
} from "@/lib/memoryView";

type ManagedScope = "global" | "project";

function folderName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

// Projects opened in agent mode, newest first (kept by app/page.tsx).
function recentWorkspaces(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem("marven-recent-workspaces") ?? "[]");
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string" && p.length > 0) : [];
  } catch {
    return [];
  }
}

const smallButton =
  "rounded-md border border-[var(--m-border)] px-2.5 py-1 text-[10px] text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:cursor-not-allowed disabled:opacity-40";
const linkButton = "text-[10px] text-[var(--m-text-faint)] transition-colors hover:text-[var(--m-text)]";

/**
 * Settings → Memory: view, add, edit, delete, export and clear what Marven
 * remembers — globally, and for the open project when there is one. Without
 * one (chat mode), a recent project can be picked instead.
 */
export function MemoryManager({ workspaceRoot: openRoot }: { workspaceRoot: string | null }) {
  const { t: tr } = useT();
  const recents = useMemo(() => (openRoot ? [] : recentWorkspaces()), [openRoot]);
  const [pickedRoot, setPickedRoot] = useState<string | null>(null);
  const workspaceRoot = openRoot ?? pickedRoot;
  const [entries, setEntries] = useState<MemoryEntriesByScope | null>(null);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    try {
      setEntries(await fetchMemoryEntries({ workspaceRoot }));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    void reload();
    const onChange = () => void reload();
    window.addEventListener(MEMORY_CHANGED_EVENT, onChange);
    window.addEventListener(MEMORY_SAVED_EVENT, onChange);
    return () => {
      window.removeEventListener(MEMORY_CHANGED_EVENT, onChange);
      window.removeEventListener(MEMORY_SAVED_EVENT, onChange);
    };
  }, [reload]);

  if (loadError && !entries) {
    return <p className="text-[12px] text-red-400/80">{tr("settings.memory.loadFailed")}</p>;
  }
  if (!entries) {
    return <p className="text-[12px] text-[var(--m-text-faint)]">{tr("settings.memory.loading")}</p>;
  }

  return (
    <div className="space-y-5">
      <MemorySection
        scope="global"
        title={tr("settings.memory.global")}
        hint={tr("settings.memory.globalHint")}
        entries={entries.global}
        workspaceRoot={workspaceRoot}
        onChanged={reload}
      />
      {!openRoot && recents.length > 0 && (
        <label className="flex items-center gap-2 text-[11px] text-[var(--m-text-muted)]">
          {tr("settings.memory.pickProject")}
          <select
            value={pickedRoot ?? ""}
            onChange={(e) => setPickedRoot(e.target.value || null)}
            className="min-w-0 flex-1 rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] px-2 py-1 text-[11px] text-[var(--m-text)]"
          >
            <option value="">{tr("settings.memory.globalOnly")}</option>
            {recents.map((root) => (
              <option key={root} value={root} title={root}>
                {folderName(root)}
              </option>
            ))}
          </select>
        </label>
      )}
      {workspaceRoot ? (
        <MemorySection
          scope="project"
          title={tr("settings.memory.project")}
          hint={tr("settings.memory.projectHint", { name: folderName(workspaceRoot) })}
          entries={entries.project}
          workspaceRoot={workspaceRoot}
          onChanged={reload}
        />
      ) : recents.length === 0 ? (
        <p className="text-[11px] text-[var(--m-text-faint)]">{tr("settings.memory.noProject")}</p>
      ) : null}
    </div>
  );
}

function MemorySection({
  scope,
  title,
  hint,
  entries,
  workspaceRoot,
  onChanged,
}: {
  scope: ManagedScope;
  title: string;
  hint: string;
  entries: MemoryViewEntry[];
  workspaceRoot: string | null;
  onChanged: () => Promise<void>;
}) {
  const { t: tr, i18n } = useT();
  const ctx = { workspaceRoot };
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const now = new Date();

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(false);
    try {
      await action();
      await onChanged();
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const text = draft.trim();
    if (!text || busy) return;
    if (await run(() => addMemoryEntry(scope, text, ctx))) setDraft("");
  }

  async function saveEdit(id: string) {
    const text = editText.trim();
    if (!text || busy) return;
    if (await run(() => editMemoryEntry(scope, id, text, ctx))) setEditingId(null);
  }

  function exportSection() {
    const heading = tr("settings.memory.exportHeading", { scope: title });
    const blob = new Blob([memoryExportMarkdown(heading, entries)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = memoryExportFileName(scope, new Date());
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-xl border border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-[var(--m-text)]">{title}</h3>
          <p className="mt-0.5 text-[11px] text-[var(--m-text-faint)]">{hint}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={exportSection} disabled={entries.length === 0} className={smallButton}>
            {tr("settings.memory.export")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            disabled={entries.length === 0 || busy}
            className={smallButton}
          >
            {tr("settings.memory.clearAll")}
          </button>
        </div>
      </div>

      {confirmClear && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2">
          <span className="text-[11px] text-[var(--m-text)]">{tr("settings.memory.confirmClear")}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmClear(false)} className={linkButton}>
              {tr("settings.cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await run(() => clearMemoryScope(scope, ctx))) setConfirmClear(false);
              }}
              className="rounded-md border border-red-400/40 px-2.5 py-1 text-[10px] text-red-400 hover:bg-red-400/10 disabled:opacity-40"
            >
              {tr("settings.memory.confirmClearYes")}
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="mt-3 text-[11px] text-[var(--m-text-faint)]">{tr("settings.memory.empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--m-border-subtle)]">
          {entries.map((entry) => {
            const date = relativeMemoryDate(entry.timestamp, now, i18n.language, tr("settings.memory.justNow"));
            const editing = editingId === entry.id;
            return (
              <li key={entry.id} className="py-2.5">
                {editing ? (
                  <div className="space-y-2">
                    <textarea
                      autoFocus
                      dir="auto"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveEdit(entry.id);
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setEditingId(null);
                        }
                      }}
                      rows={2}
                      aria-label={tr("settings.memory.edit")}
                      className="w-full resize-y rounded-md border border-[var(--m-border)] bg-[var(--m-bg)] px-3 py-2 text-[12px] text-[var(--m-text)] focus:border-[var(--m-accent)] focus:outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEditingId(null)} className={linkButton}>
                        {tr("settings.cancel")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveEdit(entry.id)}
                        disabled={busy || !editText.trim()}
                        className="rounded-md border border-[var(--m-accent)]/40 bg-[var(--m-accent-soft)] px-2.5 py-1 text-[10px] font-medium text-[var(--m-accent)] disabled:opacity-40"
                      >
                        {tr("settings.save")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p dir="auto" className="whitespace-pre-wrap break-words text-start text-[12px] text-[var(--m-text)]">
                        {entry.text}
                      </p>
                      {date && (
                        <p className="mt-0.5 text-[10px] text-[var(--m-text-faint)]" title={entry.timestamp ?? undefined}>
                          {date}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-3 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(entry.id);
                          setEditText(entry.text);
                        }}
                        className={linkButton}
                      >
                        {tr("settings.memory.edit")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(() => deleteMemoryEntry(scope, entry.id, ctx))}
                        className="text-[10px] text-[var(--m-text-faint)] transition-colors hover:text-red-400 disabled:opacity-40"
                      >
                        {tr("settings.memory.delete")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          type="text"
          dir="auto"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={tr("settings.memory.addPlaceholder")}
          aria-label={tr("settings.memory.addPlaceholder")}
          maxLength={4000}
          className="min-w-0 flex-1 rounded-md border border-[var(--m-border)] bg-[var(--m-bg)] px-3 py-1.5 text-[12px] text-[var(--m-text)] placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-accent)] focus:outline-none"
        />
        <button type="submit" disabled={busy || !draft.trim()} className={smallButton}>
          {tr("settings.memory.add")}
        </button>
      </form>

      {error && <p className="mt-2 text-[11px] text-red-400/80">{tr("settings.memory.saveFailed")}</p>}
    </section>
  );
}
