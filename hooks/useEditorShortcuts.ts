"use client";

import { useEffect } from "react";

export interface EditorShortcutsOptions {
  onSave: () => void;
  onCloseTab: () => void;
  onToggleExplorer: () => void;
  onToggleTerminal: () => void;
  onToggleChat: () => void;
  onQuickOpen: () => void;
  onCommandPalette: () => void;
  enabled?: boolean;
}

const isMac =
  typeof navigator !== "undefined" &&
  navigator.platform.toLowerCase().includes("mac");

export function useEditorShortcuts(opts: EditorShortcutsOptions): void {
  const {
    onSave,
    onCloseTab,
    onToggleExplorer,
    onToggleTerminal,
    onToggleChat,
    onQuickOpen,
    onCommandPalette,
    enabled = true,
  } = opts;

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true";

      const mod = isMac ? e.metaKey : e.ctrlKey;
      const ctrl = e.ctrlKey;
      const shift = e.shiftKey;

      // Cmd/Ctrl + Shift + P — Command Palette (always fires)
      if (mod && shift && e.key === "p") {
        e.preventDefault();
        onCommandPalette();
        return;
      }

      // Cmd/Ctrl + P — Quick Open (always fires)
      if (mod && !shift && e.key === "p") {
        e.preventDefault();
        onQuickOpen();
        return;
      }

      // Cmd/Ctrl + S — Save (always fires)
      if (mod && e.key === "s") {
        e.preventDefault();
        onSave();
        return;
      }

      // Cmd/Ctrl + W — Close Tab (always fires)
      if (mod && e.key === "w") {
        e.preventDefault();
        onCloseTab();
        return;
      }

      // Toggle shortcuts — also always fire
      // Cmd/Ctrl + B — Toggle Explorer
      if (mod && e.key === "b") {
        e.preventDefault();
        onToggleExplorer();
        return;
      }

      // Ctrl + ` — Toggle Terminal
      if (ctrl && e.key === "`") {
        e.preventDefault();
        onToggleTerminal();
        return;
      }

      // Ctrl + Cmd + I (mac) / Ctrl + Shift + I (others) — Toggle Chat
      if (isMac) {
        if (ctrl && e.metaKey && e.key === "i") {
          e.preventDefault();
          onToggleChat();
          return;
        }
      } else {
        if (ctrl && shift && e.key === "i") {
          e.preventDefault();
          onToggleChat();
          return;
        }
      }

      // Skip remaining combos when focused in an input/textarea/contenteditable
      if (inInput) return;
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    onSave,
    onCloseTab,
    onToggleExplorer,
    onToggleTerminal,
    onToggleChat,
    onQuickOpen,
    onCommandPalette,
  ]);
}
