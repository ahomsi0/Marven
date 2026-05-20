"use client";

import { useMemo } from "react";

interface Symbol {
  name: string;
  kind: "function" | "class" | "component" | "const" | "interface" | "type";
  line: number; // 1-based
}

function extractSymbols(content: string, ext: string): Symbol[] {
  const lines = content.split("\n");
  const symbols: Symbol[] = [];
  const lower = ext.toLowerCase().replace(/^\./, "");

  const isTS = ["ts", "tsx", "js", "jsx"].includes(lower);
  const isPy = lower === "py";

  lines.forEach((line, i) => {
    const lineNum = i + 1;
    const trimmed = line.trim();
    if (!trimmed) return;

    if (isTS) {
      // Function declarations: function name(
      let m = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Z_a-z]\w*)\s*[(<]/);
      if (m) { symbols.push({ name: m[1], kind: /^[A-Z]/.test(m[1]) ? "component" : "function", line: lineNum }); return; }
      // Arrow functions / const: const name = (
      m = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Z_a-z]\w*)\s*=\s*(?:async\s*)?\(/);
      if (m) { symbols.push({ name: m[1], kind: /^[A-Z]/.test(m[1]) ? "component" : "const", line: lineNum }); return; }
      // Class declarations
      m = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+([A-Z_a-z]\w*)/);
      if (m) { symbols.push({ name: m[1], kind: "class", line: lineNum }); return; }
      // Interface declarations
      m = trimmed.match(/^(?:export\s+)?interface\s+([A-Z_a-z]\w*)/);
      if (m) { symbols.push({ name: m[1], kind: "interface", line: lineNum }); return; }
      // Type aliases
      m = trimmed.match(/^(?:export\s+)?type\s+([A-Z_a-z]\w*)\s*=/);
      if (m) { symbols.push({ name: m[1], kind: "type", line: lineNum }); return; }
    }

    if (isPy) {
      let m = trimmed.match(/^(?:async\s+)?def\s+([A-Z_a-z]\w*)\s*\(/);
      if (m) { symbols.push({ name: m[1], kind: "function", line: lineNum }); return; }
      m = trimmed.match(/^class\s+([A-Z_a-z]\w*)/);
      if (m) { symbols.push({ name: m[1], kind: "class", line: lineNum }); return; }
    }
  });

  return symbols;
}

const KIND_COLORS: Record<Symbol["kind"], string> = {
  function:  "text-[var(--m-accent)]",
  component: "text-blue-400/80",
  class:     "text-yellow-400/80",
  interface: "text-purple-400/80",
  type:      "text-green-400/80",
  const:     "text-[var(--m-text-faint)]",
};

const KIND_ICON: Record<Symbol["kind"], string> = {
  function:  "ƒ",
  component: "◈",
  class:     "C",
  interface: "I",
  type:      "T",
  const:     "v",
};

interface SymbolOutlineProps {
  content: string;
  filePath: string;
  onJumpToLine: (line: number) => void;
}

export function SymbolOutline({ content, filePath, onJumpToLine }: SymbolOutlineProps) {
  const ext = filePath.split(".").pop() ?? "";
  const symbols = useMemo(() => extractSymbols(content, ext), [content, ext]);

  if (symbols.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-[var(--m-text-faint)]">No symbols found</div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      {symbols.map((sym, i) => (
        <button
          key={`${sym.name}-${sym.line}-${i}`}
          type="button"
          onClick={() => onJumpToLine(sym.line)}
          className="flex items-center gap-2 px-3 py-1 text-left text-[11px] hover:bg-[var(--m-surface-2)]"
        >
          <span className={`w-3 shrink-0 font-mono text-[10px] ${KIND_COLORS[sym.kind]}`}>
            {KIND_ICON[sym.kind]}
          </span>
          <span className="truncate text-[var(--m-text-muted)]">{sym.name}</span>
          <span className="ml-auto shrink-0 text-[9px] text-[var(--m-text-faint)]">{sym.line}</span>
        </button>
      ))}
    </div>
  );
}
