"use client";

interface DiskConflictModalProps {
  path: string;
  onReloadDisk: () => void;
  onKeepLocal: () => void;
}

export function DiskConflictModal({ path, onReloadDisk, onKeepLocal }: DiskConflictModalProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        role="dialog"
        aria-modal
        aria-labelledby="disk-conflict-title"
        className="relative z-10 w-full max-w-md rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] p-4 shadow-xl"
      >
        <h2 id="disk-conflict-title" className="font-mono text-[13px] text-[var(--m-text)]">
          File changed on disk
        </h2>
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-[var(--m-text-muted)]">
          <code className="rounded bg-[var(--m-surface-2)] px-1 py-0.5 text-[10px]">{path}</code> was
          modified externally while you have unsaved edits in the editor.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onKeepLocal}
            className="rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-3 py-1.5 font-mono text-[11px] text-[var(--m-text)] hover:border-[var(--m-text-faint)]"
          >
            Keep mine
          </button>
          <button
            type="button"
            onClick={onReloadDisk}
            className="rounded border border-[#d19a66]/50 bg-[#d19a66]/15 px-3 py-1.5 font-mono text-[11px] text-[#d19a66] hover:bg-[#d19a66]/25"
          >
            Reload from disk
          </button>
        </div>
      </div>
    </div>
  );
}
