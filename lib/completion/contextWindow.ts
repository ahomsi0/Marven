export interface ContextWindow {
  /** Content before the cursor. */
  prefix: string;
  /** Content after the cursor. */
  suffix: string;
  /** Filename without path. */
  filename: string;
  /** Language id (e.g. "typescript", "python") — best-effort from extension. */
  languageId: string;
  /** 0-indexed line of the cursor in the original document. */
  cursorLine: number;
}

export interface ContextWindowOptions {
  /** Default 50. */
  linesBefore?: number;
  /** Default 20. */
  linesAfter?: number;
  /** Default 8000 chars per side — hard cap to bound token usage. */
  maxCharsPerSide?: number;
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  scala: "scala",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  html: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  lua: "lua",
};

function deriveLanguageId(filePath: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(filePath);
  if (!m) return "plaintext";
  return EXT_LANG[m[1].toLowerCase()] ?? "plaintext";
}

function basename(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx === -1 ? filePath : filePath.slice(idx + 1);
}

export function extractContextWindow(
  doc: string,
  cursorOffset: number,
  filePath: string,
  opts?: ContextWindowOptions,
): ContextWindow {
  const linesBefore = opts?.linesBefore ?? 50;
  const linesAfter = opts?.linesAfter ?? 20;
  const maxCharsPerSide = opts?.maxCharsPerSide ?? 8000;

  const clamped = Math.max(0, Math.min(cursorOffset, doc.length));
  const before = doc.slice(0, clamped);
  const after = doc.slice(clamped);

  const cursorLine = before.split("\n").length - 1;

  // Slice prefix by lines from the end
  const beforeLines = before.split("\n");
  const prefixStartLine = Math.max(0, beforeLines.length - 1 - linesBefore);
  let prefix = beforeLines.slice(prefixStartLine).join("\n");

  const afterLines = after.split("\n");
  // afterLines[0] is rest of the current line. Keep up to linesAfter additional lines.
  let suffix = afterLines.slice(0, linesAfter + 1).join("\n");

  // Clamp from inside (closest to cursor): keep the END of prefix and START of suffix.
  if (prefix.length > maxCharsPerSide) {
    prefix = prefix.slice(prefix.length - maxCharsPerSide);
  }
  if (suffix.length > maxCharsPerSide) {
    suffix = suffix.slice(0, maxCharsPerSide);
  }

  return {
    prefix,
    suffix,
    filename: basename(filePath),
    languageId: deriveLanguageId(filePath),
    cursorLine,
  };
}
