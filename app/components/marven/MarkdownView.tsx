"use client";

// Markdown tab renderer. Either pure-edit (CodeEditor on the full width) or
// split view: editor on the left, react-markdown preview on the right. The
// toggle button in the top-right of the tab content area flips between them.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeEditor, type CodeEditorActions } from "@/app/components/marven/CodeEditor";

interface MarkdownViewProps {
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  theme: "dark" | "light";
  preview: boolean;
  onTogglePreview: () => void;
  onReady: (actions: CodeEditorActions) => void;
}

export function MarkdownView({
  value,
  onChange,
  onSave,
  theme,
  preview,
  onTogglePreview,
  onReady,
}: MarkdownViewProps) {
  return (
    <div className="flex h-full w-full flex-col">
      {/* Mode toggle strip */}
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-3 py-1">
        <span className="mr-auto text-[9px] uppercase tracking-[0.15em] text-[var(--m-text-faint)]">
          Markdown
        </span>
        <button
          type="button"
          onClick={onTogglePreview}
          className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
            preview
              ? "bg-[var(--m-accent)]/15 text-[var(--m-accent)]"
              : "text-[var(--m-text-faint)] hover:bg-[var(--m-surface-3)] hover:text-[var(--m-text-muted)]"
          }`}
          title="Toggle preview pane"
        >
          {preview ? "Preview on" : "Preview off"}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Editor */}
        <div className={preview ? "min-w-0 flex-1 border-r border-[var(--m-border-subtle)]" : "min-w-0 flex-1"}>
          <CodeEditor
            value={value}
            onChange={onChange}
            language="markdown"
            theme={theme}
            onSave={onSave}
            onReady={onReady}
          />
        </div>

        {/* Preview */}
        {preview && (
          <div className="min-w-0 flex-1 overflow-auto bg-[var(--m-bg)] px-6 py-5">
            <article className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{value || "*Empty document*"}</ReactMarkdown>
            </article>
          </div>
        )}
      </div>
    </div>
  );
}
