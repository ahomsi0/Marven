"use client";

import { useRef, useEffect, useCallback, useState, useMemo, type MutableRefObject, type ReactNode } from "react";
import type { EditorTab, CustomShortcut, MCPServer, PromptTemplate, AIProvider, EditorProblem } from "@/types";
import { SettingsModal } from "./SettingsModal";
import { InlineEditPrompt } from "./InlineEditPrompt";
import { CodeEditor, type CodeEditorActions } from "./CodeEditor";
import { TerminalView } from "./TerminalView";
import { ImagePreview } from "./ImagePreview";
import { PdfPreview } from "./PdfPreview";
import { MarkdownView } from "./MarkdownView";
import { useTheme } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { decodePreviewRoot, workspacePreviewUrl } from "@/lib/previewUrl";
import { RestClientPanel } from "./RestClientPanel";
import { ProblemsPanel } from "./ProblemsPanel";
import type { VoiceState } from "@/hooks/useVoice";

interface EditorPanelProps {
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  fileContent: string;
  fileError?: string | null;
  isFileLoading: boolean;
  isFileDirty: boolean;
  terminalOutput: string;
  showTerminal: boolean;
  onToggleTerminal: () => void;
  /** Which sub-view is active when the bottom panel is expanded. */
  bottomTab?: "terminal" | "problems";
  onBottomTabChange?: (tab: "terminal" | "problems") => void;
  onFileContentChange: (value: string) => void;
  onSaveFile: () => void;
  onCloseFile?: () => void;
  // Multi-tab props
  openTabs: EditorTab[];
  activeTabIndex: number;
  fileBuffers: Map<string, { content: string; dirty: boolean; loading: boolean }>;
  /** Cross-file LSP edit handler (F2 rename, etc.). When omitted, multi-file edits are dropped. */
  onApplyWorkspaceEdit?: (edit: import("@/types").LspWorkspaceEdit) => Promise<void>;
  /** Inline-completion settings (enabled/provider/model/debounce). When null/undefined or disabled, no ghost text. */
  inlineCompletions?: import("@/lib/completion/settingsClient").InlineCompletionSettings | null;
  onSelectTab: (index: number) => void;
  onCloseTab: (index: number) => void;
  onReorderTabs: (from: number, to: number) => void;
  // Settings tab props
  shortcuts?: CustomShortcut[];
  promptTemplates?: PromptTemplate[];
  mcpServers?: MCPServer[];
  onSaveShortcuts?: (shortcuts: CustomShortcut[]) => void;
  onSaveTemplates?: (templates: PromptTemplate[]) => void;
  onSaveMCPServers?: (servers: MCPServer[]) => void;
  voiceDiagnostics?: {
    isVoiceSupported: boolean;
    voiceState: VoiceState;
    wakeEnabled: boolean;
    speechEnabled: boolean;
    sttProvider: "local" | "groq";
    ttsProvider: "system" | "elevenlabs";
    isSpeakingNow: boolean;
    voiceError: string | null;
    lastHeard: string;
  };
  // Empty state action props
  onToggleChat?: () => void;
  /** Replaces the tabs + editor area (e.g. the Changes diff) while keeping the
   *  bottom terminal panel and status bar in place. */
  mainContent?: ReactNode;
  onCommandPalette?: () => void;
  // Find / Replace bar — state lifted to AgentWorkspace so ⌘F shortcuts can
  // drive it. The ref lets the parent invoke navigation/focus.
  findOpen?: boolean;
  replaceVisible?: boolean;
  onCloseFind?: () => void;
  onToggleReplace?: () => void;
  // editorActionsRef — same ref as the old findActionsRef but with inline-edit
  // trigger added. Renamed via interface but kept name on the prop for
  // backward compat with callers.
  findActionsRef?: MutableRefObject<{
    next: () => void;
    prev: () => void;
    focus: () => void;
    triggerInlineEdit: () => void;
  } | null>;
  // Direct handle on the underlying CodeEditor actions. Used by parents that
  // need to drive the editor (e.g. global-search jumping to a specific line).
  editorActionsRef?: MutableRefObject<CodeEditorActions | null>;
  // ⌘K inline edit — provider/model are needed to drive the API call.
  provider?: AIProvider;
  model?: string;
  // Preview tab
  onOpenPreview?: (url: string) => void;
  /** Root-relative path of the workspace's top-level index.html, when it has one. */
  siteEntry?: string | null;
  /** Opens that page in an editor tab and its preview tab. */
  onPreviewSite?: () => void;
  /** When true, shows a scroll progress indicator on the right edge of the code editor. */
  showMinimap?: boolean;
  /** LSP diagnostics aggregated for the Problems tab. */
  problems?: EditorProblem[];
  onProblemSelect?: (path: string, line: number, column: number) => void;
  /** Persist editor scroll position per file tab (code files only). */
  onEditorScroll?: (scrollTop: number) => void;
}

// ── Preview pane ───────────────────────────────────────────────────────────────

function PreviewPane({ url, workspaceRoot, onClose: _onClose }: { url: string; workspaceRoot?: string; onClose?: () => void }) {
  const [currentUrl, setCurrentUrl] = useState(url);
  const [inputUrl, setInputUrl] = useState(url);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  function navigate(target: string) {
    let resolved = target.trim();
    if (resolved.startsWith("file://")) {
      // Convert file:// → HTTP serve endpoint so the iframe can load it
      const filePath = decodeURIComponent(resolved.replace(/^file:\/\//, ""));
      // Inside the workspace: the path-shaped preview route, so the page's
      // relative links (CSS, JS, images) resolve too.
      resolved = workspaceRoot && filePath.startsWith(`${workspaceRoot}/`)
        ? workspacePreviewUrl(workspaceRoot, filePath.slice(workspaceRoot.length + 1))
        : `/api/workspace/serve?path=${encodeURIComponent(filePath)}${
            workspaceRoot ? `&root=${encodeURIComponent(workspaceRoot)}` : ""
          }`;
    } else if (!resolved.startsWith("http://") && !resolved.startsWith("https://") && !resolved.startsWith("/")) {
      resolved = `https://${resolved}`;
    }
    setCurrentUrl(resolved);
    setInputUrl(resolved);
  }

  function refresh() {
    if (iframeRef.current) {
      const src = iframeRef.current.src;
      iframeRef.current.src = "about:blank";
      setTimeout(() => { if (iframeRef.current) iframeRef.current.src = src; }, 50);
    }
  }

  async function openInBrowser() {
    const raw = currentUrl?.trim() ?? "";
    if (!raw) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = (window as any).marvenElectron;
    // A page in a workspace folder: its in-app address is under /api/, which
    // needs Marven's API token, so serve the folder on 127.0.0.1 instead.
    const local = /^\/api\/workspace\/preview\/@([^/?#]+)\/([^?#]*)/.exec(raw);
    const root = local ? decodePreviewRoot(local[1]) : null;
    if (local && root && electron?.openFolderInBrowser) {
      try {
        const res = await electron.openFolderInBrowser(root, local[2]);
        if (res?.ok) return;
      } catch {
        /* fall through to the plain address */
      }
    }
    let absolute: string;
    try {
      absolute = new URL(raw, window.location.origin).href;
    } catch {
      return;
    }
    if (electron?.openExternal) void electron.openExternal(absolute, "default").catch(() => {});
    else window.open(absolute, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex h-full flex-col bg-[var(--m-bg)]">
      {/* URL bar */}
      <div className="flex items-center gap-1.5 border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-2 py-1.5">
        <button type="button" onClick={refresh} title="Refresh" className="rounded p-1 text-[var(--m-text-faint)] hover:bg-[var(--m-surface-3)] hover:text-[var(--m-text-muted)]">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
        </button>
        <input
          type="text"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") navigate(inputUrl); }}
          onFocus={(e) => e.target.select()}
          className="flex-1 rounded border border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-2 py-0.5 text-[11px] text-[var(--m-text-muted)] outline-none focus:border-[var(--m-text-faint)]"
        />
        <button type="button" onClick={() => void openInBrowser()} title="Open in browser" className="rounded p-1 text-[var(--m-text-faint)] hover:bg-[var(--m-surface-3)] hover:text-[var(--m-text-muted)]">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </button>
      </div>
      {/* iframe */}
      <iframe
        ref={iframeRef}
        src={currentUrl}
        className="min-h-0 flex-1 border-0 bg-white"
        // Keep preview scripts functional, but give the document an opaque
        // origin so workspace HTML cannot read or mutate Marven's local APIs.
        sandbox="allow-scripts"
        title="Preview"
      />
    </div>
  );
}

// ── Tab type icon ──────────────────────────────────────────────────────────────

// File-type tint for the tab icon — a plain document glyph, coloured by language.
const TAB_ICON_COLORS: Record<string, string> = {
  ts: "#3b82f6", tsx: "#3b82f6", js: "#d6b13c", jsx: "#d6b13c", mjs: "#d6b13c", cjs: "#d6b13c",
  json: "#d6b13c", md: "#6b9bd8", mdx: "#6b9bd8", py: "#4b8bbe", html: "#e07b39", css: "#c86fc9",
  scss: "#c86fc9", rs: "#d0855f", go: "#4fb3c8", sh: "#8fbf6a", yml: "#c25b5b", yaml: "#c25b5b",
  png: "#a07bd6", jpg: "#a07bd6", jpeg: "#a07bd6", gif: "#a07bd6", svg: "#a07bd6", webp: "#a07bd6",
};

function TabFileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const color = TAB_ICON_COLORS[ext];
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      style={{ color: color ?? "var(--m-text-faint)" }}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function EditorPanel({
  workspaceRoot,
  selectedFilePath,
  fileContent,
  fileError,
  isFileLoading,
  isFileDirty,
  terminalOutput,
  showTerminal,
  onToggleTerminal,
  onFileContentChange,
  onSaveFile,
  openTabs,
  activeTabIndex,
  fileBuffers,
  onApplyWorkspaceEdit,
  inlineCompletions,
  onSelectTab,
  onCloseTab,
  onReorderTabs,
  shortcuts = [],
  promptTemplates = [],
  mcpServers = [],
  onSaveShortcuts,
  onSaveTemplates,
  onSaveMCPServers,
  voiceDiagnostics,
  onToggleChat,
  mainContent,
  onCommandPalette,
  findOpen = false,
  replaceVisible = false,
  onCloseFind,
  onToggleReplace,
  findActionsRef,
  editorActionsRef: externalEditorActionsRef,
  provider = "groq",
  model = "",
  onOpenPreview,
  siteEntry = null,
  onPreviewSite,
  showMinimap = false,
  problems = [],
  onProblemSelect,
  onEditorScroll,
  bottomTab = "terminal",
  onBottomTabChange,
}: EditorPanelProps) {
  const { theme } = useTheme();
  const { t } = useT();
  const editorActionsRef = useRef<CodeEditorActions | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isWindows, setIsWindows] = useState(false);
  useEffect(() => {
    const el = (window as unknown as { marvenElectron?: { platform?: string } }).marvenElectron;
    setIsWindows(el?.platform === "win32");
  }, []);

  // Find / Replace state — query strings and current active match index.
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);

  // ⌘K Inline AI edit state. We capture the selection's character offsets at
  // trigger time so that even if the editor loses focus to the prompt input,
  // we still know what range to splice.
  const [inlineEdit, setInlineEdit] = useState<{
    selection: string;
    start: number;
    end: number;
  } | null>(null);
  // Brief floating tooltip when the user presses ⌘K without a selection.
  const [noSelectionHint, setNoSelectionHint] = useState(false);
  useEffect(() => {
    if (!noSelectionHint) return;
    const t = setTimeout(() => setNoSelectionHint(false), 3000);
    return () => clearTimeout(t);
  }, [noSelectionHint]);

  const activeFileName = selectedFilePath?.split("/").pop() ?? null;
  const fileExt = activeFileName?.split(".").pop()?.toLowerCase() ?? "";
  // Tab content type — drives whether we render the code editor, a markdown
  // preview, an image, or a PDF. All four use the same EditorTab "file" kind
  // (the underlying buffer is still fetched the same way); only the renderer
  // differs.
  const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]);
  const PDF_EXTS = new Set(["pdf"]);
  const MARKDOWN_EXTS = new Set(["md", "mdx", "markdown"]);
  const isImage = IMAGE_EXTS.has(fileExt);
  const isPdf = PDF_EXTS.has(fileExt);
  const isMarkdown = MARKDOWN_EXTS.has(fileExt);
  // Side-by-side markdown preview is opt-in via a per-tab toggle so users
  // who want to edit the raw markdown can disable it.
  const [markdownPreview, setMarkdownPreview] = useState(true);
  const projectName = workspaceRoot?.split("/").filter(Boolean).pop() ?? "workspace";
  const activeTabForScroll =
    activeTabIndex >= 0 && activeTabIndex < openTabs.length ? openTabs[activeTabIndex] : null;
  const tabScrollRestore =
    activeTabForScroll?.kind === "file" && typeof activeTabForScroll.scrollTop === "number"
      ? activeTabForScroll.scrollTop
      : undefined;
  const relativeFilePath = workspaceRoot && selectedFilePath
    ? selectedFilePath.startsWith(workspaceRoot)
      ? selectedFilePath.slice(workspaceRoot.length).replace(/^\//, "")
      : activeFileName ?? ""
    : activeFileName ?? "";

  // Breadcrumb path segments — project name + relative file path slices.
  const breadcrumbSegments = useMemo(() => {
    if (!selectedFilePath) return [] as string[];
    const parts = relativeFilePath ? relativeFilePath.split("/").filter(Boolean) : [];
    return [projectName, ...parts];
  }, [selectedFilePath, relativeFilePath, projectName]);

  // ── Find / Replace ───────────────────────────────────────────────────────
  // Compute substring matches case-insensitively. Empty query → no matches.
  // We do NOT use regex on the user input — treat the query as literal text.
  const matches = useMemo<Array<{ start: number; end: number }>>(() => {
    if (!findQuery || isFileLoading) return [];
    const hay = fileContent.toLowerCase();
    const needle = findQuery.toLowerCase();
    if (!needle) return [];
    const out: Array<{ start: number; end: number }> = [];
    let i = 0;
    while (i <= hay.length - needle.length) {
      const idx = hay.indexOf(needle, i);
      if (idx === -1) break;
      out.push({ start: idx, end: idx + needle.length });
      i = idx + needle.length;
      // Cap to avoid pathological cases (e.g. searching "a" in a huge buffer).
      if (out.length >= 5000) break;
    }
    return out;
  }, [findQuery, fileContent, isFileLoading]);
  const totalMatches = matches.length;

  // Clamp activeMatch when the matches array shrinks.
  useEffect(() => {
    if (totalMatches === 0) {
      if (activeMatch !== 0) setActiveMatch(0);
    } else if (activeMatch >= totalMatches) {
      setActiveMatch(totalMatches - 1);
    }
  }, [totalMatches, activeMatch]);

  // Scroll the active match into view via the CodeMirror actions API.
  const scrollMatchIntoView = useCallback((index: number) => {
    if (index < 0 || index >= matches.length) return;
    const offset = matches[index].start;
    editorActionsRef.current?.scrollToPos(offset);
  }, [matches]);

  const goToNext = useCallback(() => {
    if (totalMatches === 0) return;
    const next = (activeMatch + 1) % totalMatches;
    setActiveMatch(next);
    scrollMatchIntoView(next);
  }, [totalMatches, activeMatch, scrollMatchIntoView]);

  const goToPrev = useCallback(() => {
    if (totalMatches === 0) return;
    const prev = (activeMatch - 1 + totalMatches) % totalMatches;
    setActiveMatch(prev);
    scrollMatchIntoView(prev);
  }, [totalMatches, activeMatch, scrollMatchIntoView]);

  const replaceOne = useCallback(() => {
    if (totalMatches === 0) return;
    const m = matches[activeMatch];
    const newContent = fileContent.slice(0, m.start) + replaceQuery + fileContent.slice(m.end);
    onFileContentChange(newContent);
    // Stay on the same index — what was at N+1 slots into N after splice. The
    // clamp effect handles the case where we replaced the last match. The
    // recomputed `matches` array (via the fileContent change) will refresh
    // the overlay highlight to the new active position.
  }, [totalMatches, matches, activeMatch, replaceQuery, fileContent, onFileContentChange]);

  const replaceAll = useCallback(() => {
    if (totalMatches === 0) return;
    // Walk backwards so earlier indices stay valid as we splice.
    let next = fileContent;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      next = next.slice(0, m.start) + replaceQuery + next.slice(m.end);
    }
    onFileContentChange(next);
    setActiveMatch(0);
  }, [totalMatches, matches, replaceQuery, fileContent, onFileContentChange]);

  // Accept the AI rewrite — splice `replacement` into `fileContent` at the
  // captured offsets. We deliberately do NOT manipulate trailing newlines:
  // the spec calls for preserving the file's existing trailing-newline
  // behavior, which means treating the replacement as a verbatim substitution
  // for the selected range.
  const acceptInlineEdit = useCallback((replacement: string) => {
    if (!inlineEdit) return;
    const next =
      fileContent.slice(0, inlineEdit.start) +
      replacement +
      fileContent.slice(inlineEdit.end);
    onFileContentChange(next);
    setInlineEdit(null);
    requestAnimationFrame(() => editorActionsRef.current?.focus());
  }, [inlineEdit, fileContent, onFileContentChange]);

  const rejectInlineEdit = useCallback(() => {
    setInlineEdit(null);
    requestAnimationFrame(() => editorActionsRef.current?.focus());
  }, []);

  // ⌘K Inline edit trigger — reads the CodeMirror selection. If empty (no
  // actual range highlighted), surface the "Select code first" hint and bail.
  // Otherwise capture the [start, end) range + text and open the bar.
  const triggerInlineEdit = useCallback(() => {
    if (!selectedFilePath || isFileLoading) return;
    const sel = editorActionsRef.current?.getSelection();
    if (!sel || sel.text.length === 0) {
      setNoSelectionHint(true);
      return;
    }
    setNoSelectionHint(false);
    setInlineEdit({ selection: sel.text, start: sel.from, end: sel.to });
  }, [selectedFilePath, isFileLoading]);

  // Publish actions for the parent (AgentWorkspace) to drive via shortcuts.
  useEffect(() => {
    if (!findActionsRef) return;
    findActionsRef.current = {
      next: goToNext,
      prev: goToPrev,
      focus: () => {
        const el = findInputRef.current;
        if (!el) return;
        el.focus();
        el.select();
      },
      triggerInlineEdit,
    };
    return () => {
      if (findActionsRef) findActionsRef.current = null;
    };
  }, [findActionsRef, goToNext, goToPrev, triggerInlineEdit]);

  // When the find bar opens, focus its input. When it closes, clear the
  // active match index so subsequent re-opens start from the top.
  useEffect(() => {
    if (findOpen) {
      requestAnimationFrame(() => {
        const el = findInputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      });
    } else {
      setActiveMatch(0);
    }
  }, [findOpen]);

  // When activeMatch changes (e.g. via ⌘G outside the bar), scroll it in view.
  useEffect(() => {
    if (findOpen && totalMatches > 0) {
      scrollMatchIntoView(activeMatch);
    }
    // We only want this to fire on activeMatch changes, not on every match
    // recomputation — otherwise typing in the find input would force-scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatch]);

  function closeFindAndReturnFocus() {
    onCloseFind?.();
    requestAnimationFrame(() => editorActionsRef.current?.focus());
  }

  // Detect language label for status bar
  const langLabel = ["ts", "tsx"].includes(fileExt)
    ? "TypeScript"
    : ["js", "jsx"].includes(fileExt)
    ? "JavaScript"
    : fileExt.toUpperCase() || "Plain Text";

  const activeTab = activeTabIndex >= 0 && activeTabIndex < openTabs.length ? openTabs[activeTabIndex] : null;
  const isSettingsTabActive = activeTab?.kind === "settings";
  const isPreviewTabActive = activeTab?.kind === "preview";
  const isRestTabActive = activeTab?.kind === "rest";

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--m-surface)]">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {mainContent ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{mainContent}</div>
        ) : (
        /* Editor */
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Multi-tab strip */}
          {openTabs.length > 0 && (
            <div
              className="flex shrink-0 items-stretch overflow-x-auto overflow-y-hidden bg-[var(--m-bg)] shadow-[inset_0_-1px_0_var(--m-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              onDragLeave={(e) => {
                // Only clear if leaving the tab strip entirely (not entering a child)
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverIndex(null);
                }
              }}
            >
              {openTabs.map((tab, i) => {
                const isActive = i === activeTabIndex;
                const label = tab.kind === "settings"
                  ? "Settings"
                  : tab.kind === "preview"
                  ? (() => { try { return new URL(tab.url).hostname || "Preview"; } catch { return "Preview"; } })()
                  : tab.kind === "rest"
                  ? "REST"
                  : tab.path.split("/").pop() ?? tab.path;
                const buffer = tab.kind === "file" ? fileBuffers.get(tab.path) : null;
                const isDirty = buffer?.dirty ?? false;
                return (
                  <div
                    key={tab.kind === "file" ? `file:${tab.path}` : tab.kind === "preview" ? `preview:${tab.url}` : tab.kind === "rest" ? `rest:${tab.requestId}` : "settings"}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", String(i));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverIndex(i);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverIndex(null);
                      const from = Number(e.dataTransfer.getData("text/plain"));
                      if (!isNaN(from)) onReorderTabs(from, i);
                    }}
                    onDragEnd={() => setDragOverIndex(null)}
                    onClick={() => onSelectTab(i)}
                    className={`group relative flex shrink-0 cursor-pointer items-center gap-2 border-b border-r border-r-[var(--m-border-subtle)] px-3 py-2 transition-colors ${
                      isActive
                        ? "border-b-transparent bg-[var(--m-surface)]"
                        : "border-b-[var(--m-border)] bg-[var(--m-bg)] hover:bg-[var(--m-surface)]/50"
                    }`}
                    title={tab.kind === "file" ? tab.path : tab.kind === "preview" ? tab.url : tab.kind === "rest" ? "REST Client" : "Settings"}
                  >
                    {/* Drop indicator — vertical gold line on left edge */}
                    {dragOverIndex === i && (
                      <span className="pointer-events-none absolute left-0 top-0 bottom-0 w-[2px] bg-[#d19a66]" />
                    )}
                    {tab.kind === "file" ? (
                      <TabFileIcon name={label} />
                    ) : tab.kind === "preview" ? (
                      <svg className="h-3 w-3 shrink-0 text-[var(--m-text-faint)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253M3.284 14.253A8.959 8.959 0 0 1 3 12c0-1.512.372-2.935 1.034-4.189" />
                      </svg>
                    ) : tab.kind === "rest" ? (
                      <svg className="h-3.5 w-3.5 shrink-0 text-[#d19a66]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    ) : (
                      <svg className="h-3.5 w-3.5 text-[#d19a66]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                    <span className={`text-[12px] ${isActive ? "text-[var(--m-text)]" : "text-[var(--m-text-muted)]"}`}>{label}</span>
                    {isDirty && <span className="text-[#d19a66] text-[10px]">●</span>}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onCloseTab(i); }}
                      aria-label={`Close ${label}`}
                      className="ml-1 flex h-4 w-4 items-center justify-center rounded text-[var(--m-text-faint)] transition-colors hover:bg-[var(--m-border)] hover:text-[var(--m-text)]"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
              {/* Save button lives in tab bar header area — shown when active file is dirty */}
              {isFileDirty && !isSettingsTabActive && !isPreviewTabActive && !isRestTabActive && (
                <div className="ml-auto flex items-center gap-2 px-3">
                  <button
                    type="button"
                    onClick={onSaveFile}
                    className="rounded border border-[var(--m-border)] px-2 py-1 text-[10px] text-[var(--m-text-muted)] transition-colors hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)]"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Breadcrumbs — between tab strip and find bar, when a file is open. */}
          {selectedFilePath && !isSettingsTabActive && !isPreviewTabActive && !isRestTabActive && breadcrumbSegments.length > 0 && (
            <div className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto bg-[var(--m-surface)] px-4 text-[11.5px] text-[var(--m-text-muted)]">
              {breadcrumbSegments.map((seg, i) => {
                const isLast = i === breadcrumbSegments.length - 1;
                return (
                  <span key={`${i}-${seg}`} className="flex items-center gap-1 whitespace-nowrap">
                    <span className={isLast ? "text-[var(--m-text)]" : "text-[var(--m-text-muted)]"}>
                      {seg}
                    </span>
                    {!isLast && (
                      <svg
                        className="h-3 w-3 text-[var(--m-text-faint)]"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="6 4 10 8 6 12" />
                      </svg>
                    )}
                  </span>
                );
              })}
              {/* Preview button — shown only for HTML/HTM files */}
              {activeTab?.kind === "file" && /\.(html?|htm)$/i.test(activeTab.path) && (
                <button
                  type="button"
                  onClick={() => {
                    if (activeTab.kind === "file") {
                      // Path-shaped preview URL with the workspace root in the
                      // path, so relative links inside the HTML (style.css,
                      // app.js, img/foo.png) resolve to the same folder.
                      const rel =
                        workspaceRoot && activeTab.path.startsWith(`${workspaceRoot}/`)
                          ? activeTab.path.slice(workspaceRoot.length + 1)
                          : activeTab.path;
                      onOpenPreview?.(
                        workspaceRoot
                          ? workspacePreviewUrl(workspaceRoot, rel)
                          : `/api/workspace/preview/${rel.split("/").map(encodeURIComponent).join("/")}`,
                      );
                    }
                  }}
                  title={t("agent.previewTabTitle")}
                  aria-label={t("agent.previewTabTitle")}
                  className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--m-text-faint)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text-muted)]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253M3.284 14.253A8.959 8.959 0 0 1 3 12c0-1.512.372-2.935 1.034-4.189" />
                  </svg>
                  {t("agent.previewTab")}
                </button>
              )}
            </div>
          )}

          {/* Find / Replace bar — slides in above the editor when active */}
          {findOpen && selectedFilePath && !isSettingsTabActive && !isRestTabActive && (
            <div className="flex flex-col gap-1.5 border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-3 py-2">
              {/* Find row */}
              <div className="flex items-center gap-1.5">
                {/* Toggle for replace row — chevron */}
                <button
                  type="button"
                  onClick={onToggleReplace}
                  title={replaceVisible ? "Hide replace" : "Show replace"}
                  className="rounded p-0.5 text-[var(--m-text-faint)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text-muted)]"
                >
                  <svg className="h-3 w-3 transition-transform" style={{ transform: replaceVisible ? "rotate(90deg)" : "rotate(0deg)" }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 4 10 8 6 12" />
                  </svg>
                </button>

                <input
                  ref={findInputRef}
                  value={findQuery}
                  onChange={(e) => setFindQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (e.shiftKey) goToPrev();
                      else goToNext();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      closeFindAndReturnFocus();
                    }
                  }}
                  placeholder="Find"
                  spellCheck={false}
                  className="w-48 rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1 font-mono text-[11px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-accent)]/60"
                />
                <button
                  type="button"
                  onClick={goToPrev}
                  disabled={totalMatches === 0}
                  title="Previous match (Shift+Enter / ⇧⌘G)"
                  className="rounded p-1 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 10 8 6 12 10" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={goToNext}
                  disabled={totalMatches === 0}
                  title="Next match (Enter / ⌘G)"
                  className="rounded p-1 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 6 8 10 12 6" />
                  </svg>
                </button>
                <span className="min-w-[64px] font-mono text-[10px] text-[var(--m-text-muted)] tabular-nums">
                  {totalMatches > 0
                    ? `${activeMatch + 1} of ${totalMatches}`
                    : findQuery
                    ? "No matches"
                    : ""}
                </span>

                <button
                  type="button"
                  onClick={closeFindAndReturnFocus}
                  title="Close (Esc)"
                  className="ml-auto rounded p-1 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Replace row */}
              {replaceVisible && (
                <div className="flex items-center gap-1.5">
                  <div className="w-[18px]" />{/* spacer to align with chevron above */}
                  <input
                    value={replaceQuery}
                    onChange={(e) => setReplaceQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        replaceOne();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        closeFindAndReturnFocus();
                      }
                    }}
                    placeholder="Replace"
                    spellCheck={false}
                    className="w-48 rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1 font-mono text-[11px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-accent)]/60"
                  />
                  <button
                    type="button"
                    onClick={replaceOne}
                    disabled={totalMatches === 0}
                    title="Replace current match"
                    className="rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1 text-[10px] text-[var(--m-text-muted)] transition-colors hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)] disabled:opacity-30 disabled:hover:border-[var(--m-border)] disabled:hover:text-[var(--m-text-muted)]"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={replaceAll}
                    disabled={totalMatches === 0}
                    title="Replace all matches"
                    className="rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1 text-[10px] text-[var(--m-text-muted)] transition-colors hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)] disabled:opacity-30 disabled:hover:border-[var(--m-border)] disabled:hover:text-[var(--m-text-muted)]"
                  >
                    All
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Content area — depends on active tab */}
          {isRestTabActive && activeTab?.kind === "rest" ? (
            /* REST client tab content */
            <div className="min-h-0 flex-1 overflow-hidden">
              <RestClientPanel requestId={activeTab.requestId} workspaceRoot={workspaceRoot} />
            </div>
          ) : isPreviewTabActive && activeTab?.kind === "preview" ? (
            /* Preview tab content */
            <div className="min-h-0 flex-1 overflow-hidden">
              <PreviewPane
                key={activeTab.url}
                url={activeTab.url}
                workspaceRoot={workspaceRoot ?? undefined}
                onClose={() => {
                  const previewIdx = openTabs.findIndex((t) => t.kind === "preview");
                  if (previewIdx >= 0) onCloseTab(previewIdx);
                }}
              />
            </div>
          ) : isSettingsTabActive ? (
            /* Settings tab content */
            <div className="min-h-0 flex-1 overflow-hidden bg-[var(--m-bg)]">
              <SettingsModal
                inline
                workspaceRoot={workspaceRoot}
                shortcuts={shortcuts}
                promptTemplates={promptTemplates}
                mcpServers={mcpServers}
                onSave={onSaveShortcuts ?? (() => {})}
                onSaveTemplates={onSaveTemplates ?? (() => {})}
                onSaveMCPServers={onSaveMCPServers ?? (() => {})}
                voiceDiagnostics={voiceDiagnostics}
                onClose={() => {
                  const settingsIdx = openTabs.findIndex((t) => t.kind === "settings");
                  if (settingsIdx >= 0) onCloseTab(settingsIdx);
                }}
              />
            </div>
          ) : selectedFilePath ? (
            /* File editor */
            <>
              {fileError && (
                <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 font-mono text-[11px] text-red-400">
                  File error: {fileError}
                </div>
              )}
              <div className="relative flex min-h-0 flex-1 overflow-hidden">
                {isFileLoading ? (
                  <div className="flex h-full w-full items-center justify-center font-mono text-[11px] text-[var(--m-text-faint)]">
                    Loading…
                  </div>
                ) : isImage ? (
                  <ImagePreview
                    path={relativeFilePath ?? selectedFilePath ?? ""}
                    name={activeFileName ?? ""}
                    workspaceRoot={workspaceRoot}
                  />
                ) : isPdf ? (
                  <PdfPreview path={relativeFilePath ?? selectedFilePath ?? ""} workspaceRoot={workspaceRoot} />
                ) : isMarkdown ? (
                  <MarkdownView
                    value={fileContent}
                    onChange={onFileContentChange}
                    onSave={onSaveFile}
                    theme={theme}
                    preview={markdownPreview}
                    onTogglePreview={() => setMarkdownPreview((v) => !v)}
                    onReady={(actions) => {
                      editorActionsRef.current = actions;
                      if (externalEditorActionsRef) externalEditorActionsRef.current = actions;
                    }}
                  />
                ) : (
                  <CodeEditor
                    value={fileContent}
                    onChange={onFileContentChange}
                    language={fileExt}
                    theme={theme}
                    onSave={onSaveFile}
                    showMinimap={showMinimap}
                    filePath={selectedFilePath ?? undefined}
                    workspaceRoot={workspaceRoot ?? undefined}
                    onApplyWorkspaceEdit={onApplyWorkspaceEdit}
                    inlineCompletions={inlineCompletions}
                    tabScrollRestore={tabScrollRestore}
                    onScrollPositionChange={onEditorScroll}
                    onReady={(actions) => {
                      editorActionsRef.current = actions;
                      // Mirror the handle outward so parents (AgentWorkspace)
                      // can drive scrollToLine after global-search clicks.
                      if (externalEditorActionsRef) {
                        externalEditorActionsRef.current = actions;
                      }
                    }}
                  />
                )}
                {/* "Select code first" hint — floating chip top-right of the
                    editor area, dismisses after 3s. */}
                {noSelectionHint && (
                  <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] px-2.5 py-1 text-[10px] text-[var(--m-text-muted)] shadow-lg">
                    Select code first, then press <kbd className="font-mono">⌘K</kbd>
                  </div>
                )}
              </div>
              {/* Inline edit prompt bar — anchored at the bottom of the editor
                  area (above the terminal). Renders only when a selection has
                  been captured. */}
              {inlineEdit && (
                <InlineEditPrompt
                  selection={inlineEdit.selection}
                  language={fileExt}
                  provider={provider}
                  model={model}
                  onAccept={acceptInlineEdit}
                  onReject={rejectInlineEdit}
                />
              )}
            </>
          ) : (
            /* Empty editor state — what to do next, with real shortcuts */
            <div className="flex flex-1 flex-col items-center justify-center bg-[var(--m-surface)]">
              <div className="w-64">
                <p className="text-[13px] font-medium text-[var(--m-text-muted)]">{t("agent.noFileOpen")}</p>
                <p className="mt-1 text-[12px] text-[var(--m-text-faint)]">{t("agent.noFileHint")}</p>
                {siteEntry && onPreviewSite && (
                  <button
                    type="button"
                    onClick={onPreviewSite}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--m-text)] px-3 py-2 text-[12px] font-medium text-[var(--m-bg)] transition-opacity hover:opacity-90"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3 7.5 7.03 7.5 12s2.015 9 4.5 9ZM3.6 9h16.8M3.6 15h16.8" />
                    </svg>
                    {t("agent.previewSite")}
                  </button>
                )}
                <div className="mt-2 space-y-0.5 text-[12px] text-[var(--m-text-muted)]">
                  {([
                    onToggleChat ? { label: "Show chat", keys: isWindows ? "Ctrl+Alt+I" : "⌃⌘I", onClick: onToggleChat } : null,
                    { label: "Show all commands", keys: isWindows ? "Ctrl+Shift+P" : "⇧⌘P", onClick: onCommandPalette },
                    { label: "Toggle terminal", keys: isWindows ? "Ctrl+`" : "⌃`", onClick: onToggleTerminal },
                  ].filter(Boolean) as { label: string; keys: string; onClick?: () => void }[]).map((row) => (
                    <button
                      key={row.label}
                      type="button"
                      onClick={row.onClick}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
                    >
                      <span>{row.label}</span>
                      <kbd className="font-mono text-[11px] text-[var(--m-text-faint)]">{row.keys}</kbd>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Bottom panel — Terminal + Problems (LSP diagnostics). Closing it removes
          it entirely; ⌃` / "Toggle Terminal" / the Problems command bring it back. */}
      {showTerminal && (
        <div className="flex h-[260px] shrink-0 flex-col border-t border-[var(--m-border)] bg-[var(--m-bg)]">
          <div className="flex h-8 shrink-0 cursor-default items-stretch gap-1 border-b border-[var(--m-border-subtle)] px-2">
            <button
              type="button"
              onClick={() => onBottomTabChange?.("terminal")}
              className={`flex h-full items-center border-b-2 px-2 text-[11px] font-medium transition-colors ${
                bottomTab === "terminal"
                  ? "border-[var(--m-accent)] text-[var(--m-text)]"
                  : "border-transparent text-[var(--m-text-muted)] hover:text-[var(--m-text)]"
              }`}
              title="Terminal"
            >
              Terminal
            </button>
            <button
              type="button"
              onClick={() => onBottomTabChange?.("problems")}
              className={`flex h-full items-center border-b-2 px-2 text-[11px] font-medium transition-colors ${
                bottomTab === "problems"
                  ? "border-[var(--m-accent)] text-[var(--m-text)]"
                  : "border-transparent text-[var(--m-text-muted)] hover:text-[var(--m-text)]"
              }`}
              title="Problems"
            >
              Problems{problems.length > 0 ? ` (${problems.length})` : ""}
            </button>
            <button
              type="button"
              onClick={onToggleTerminal}
              aria-label="Close panel"
              title="Close panel"
              className="ms-auto flex h-5 w-5 self-center items-center justify-center rounded text-[var(--m-text-faint)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text-muted)]"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {bottomTab === "terminal" ? (
              workspaceRoot ? (
                <TerminalView
                  ptyId={`pty:${workspaceRoot}`}
                  cwd={workspaceRoot}
                  theme={theme}
                />
              ) : (
                <div className="flex h-full items-center justify-center px-3 py-2 font-mono text-[11px] text-[var(--m-text-faint)]">
                  Open a workspace to use the terminal.
                </div>
              )
            ) : (
              <ProblemsPanel
                problems={problems}
                onSelect={(path, line, col) => onProblemSelect?.(path, line, col)}
              />
            )}
          </div>
        </div>
      )}

      {/* Status bar — the bottom panel's toggles live here so it can always be reopened */}
      <div className="flex h-6 shrink-0 items-center gap-1 border-t border-[var(--m-border)] bg-[var(--m-bg)] px-1.5 text-[11px] text-[var(--m-text-muted)]">
        {([
          { id: "terminal", label: "Terminal", d: "m5 8 4 4-4 4M12 16h7" },
          { id: "problems", label: problems.length > 0 ? `Problems ${problems.length}` : "Problems", d: "M12 8v5M12 16.5v.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z" },
        ] as const).map(({ id, label, d }) => {
          const active = showTerminal && bottomTab === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (active) onToggleTerminal();
                else {
                  onBottomTabChange?.(id);
                  if (!showTerminal) onToggleTerminal();
                }
              }}
              title={id === "terminal" ? `Toggle terminal (${isWindows ? "Ctrl+`" : "⌃`"})` : "Toggle problems"}
              className={`flex h-5 items-center gap-1 rounded px-1.5 transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] ${
                active ? "text-[var(--m-text)]" : ""
              } ${id === "problems" && problems.length > 0 && !active ? "text-amber-300/90" : ""}`}
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
                <path d={d} />
              </svg>
              {label}
            </button>
          );
        })}
        <div className="ms-auto flex items-center gap-3 px-1.5 text-[var(--m-text-faint)]">
          {activeFileName && <span className="truncate">{activeFileName}</span>}
          {selectedFilePath && <span>{langLabel}</span>}
        </div>
      </div>
    </div>
  );
}
