"use client";

interface WorkspaceBarProps {
  workspaceRoot: string | null;
  provider: string;
  model: string;
  onOpenFolder: () => void;
}

export function WorkspaceBar({ workspaceRoot, provider, model, onOpenFolder }: WorkspaceBarProps) {
  const folderName = workspaceRoot?.split("/").filter(Boolean).pop() ?? null;

  return (
    <div className="flex flex-col gap-2 border-b border-[#333] bg-[#1a1a1a] px-3 py-3">
      <button
        type="button"
        onClick={onOpenFolder}
        className="flex w-full items-center gap-2 rounded-md border border-[#333] bg-[#252525] px-3 py-2 text-left transition-colors hover:border-[#555]"
      >
        <svg className="h-3.5 w-3.5 shrink-0 text-[#d19a66]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25" />
        </svg>
        {folderName ? (
          <span className="truncate text-[11px] text-[#ddd]">{folderName}</span>
        ) : (
          <span className="text-[11px] text-[#888]">Open Folder...</span>
        )}
        {workspaceRoot && (
          <span className="ml-auto shrink-0 text-[9px] text-[#666]">change</span>
        )}
      </button>

      <div className="flex items-center gap-2">
        <span className="rounded border border-[#333] bg-[#252525] px-2 py-1 text-[9px] text-[#888] uppercase tracking-wider">
          {provider}
        </span>
        <span className="truncate text-[10px] text-[#666]">{model}</span>
      </div>
    </div>
  );
}
