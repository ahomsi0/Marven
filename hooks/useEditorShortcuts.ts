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
  onOpenSettings: () => void;
  onFind?: () => void;
  onFindAndReplace?: () => void;
  onFindNext?: () => void;
  onFindPrev?: () => void;
  // ⌘K inline AI edit — fires even when textarea/input has focus so the user
  // can select code, press ⌘K, and trigger the prompt without losing focus.
  onInlineEdit?: () => void;
  // ⌘⇧F global search across the workspace — fires even from inputs so users
  // can pop the panel open from anywhere.
  onGlobalSearch?: () => void;
  // ⌥G — toggle the built-in git panel. Fires always so users can open it
  // while typing in the commit textarea or elsewhere.
  onGitPanel?: () => void;
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
    onOpenSettings,
    onFind,
    onFindAndReplace,
    onFindNext,
    onFindPrev,
    onInlineEdit,
    onGlobalSearch,
    onGitPanel,
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

      // Cmd/Ctrl + , — Open Settings (always fires)
      if (mod && e.key === ",") {
        e.preventDefault();
        onOpenSettings();
        return;
      }

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

      // Find/Replace shortcuts — fire even from inputs so reopening refocuses.
      // Cmd/Ctrl + Option/Alt + F — Open Find AND Replace (mac & linux),
      // also accept Cmd/Ctrl + Shift + H as a Windows-style alias.
      if (mod && e.altKey && (e.key === "f" || e.key === "F" || e.key === "ƒ")) {
        if (onFindAndReplace) {
          e.preventDefault();
          onFindAndReplace();
          return;
        }
      }
      if (mod && shift && (e.key === "h" || e.key === "H")) {
        if (onFindAndReplace) {
          e.preventDefault();
          onFindAndReplace();
          return;
        }
      }

      // Cmd/Ctrl + Shift + F — Global search across the workspace. Must come
      // BEFORE the plain ⌘F handler below so we don't fall through. Fires from
      // inputs too so users can pop it open while typing anywhere.
      if (mod && shift && !e.altKey && (e.key === "f" || e.key === "F")) {
        if (onGlobalSearch) {
          e.preventDefault();
          onGlobalSearch();
          return;
        }
      }

      // Cmd/Ctrl + F — Open Find
      if (mod && !shift && !e.altKey && e.key === "f") {
        if (onFind) {
          e.preventDefault();
          onFind();
          return;
        }
      }

      // Cmd/Ctrl + K — Inline AI edit on the current textarea selection.
      // Fires even when focus is inside the editor textarea (that's where the
      // selection lives). We require a non-shift, non-alt K so it doesn't
      // collide with other ⌘K-prefixed editor chords (none defined yet).
      if (mod && !shift && !e.altKey && (e.key === "k" || e.key === "K")) {
        if (onInlineEdit) {
          e.preventDefault();
          onInlineEdit();
          return;
        }
      }

      // Cmd/Ctrl + G — Next match; Cmd/Ctrl + Shift + G — Prev match.
      // Fires even from inputs so the find input's Enter/Shift+Enter can be
      // complemented by ⌘G outside the find bar.
      if (mod && !e.altKey && (e.key === "g" || e.key === "G")) {
        if (shift) {
          if (onFindPrev) {
            e.preventDefault();
            onFindPrev();
            return;
          }
        } else {
          if (onFindNext) {
            e.preventDefault();
            onFindNext();
            return;
          }
        }
      }

      // ⌥G — Toggle git panel. Fires even from inputs so users can open the
      // panel while typing in the commit textarea.
      if (e.altKey && !mod && !shift && (e.key === "g" || e.key === "G")) {
        if (onGitPanel) {
          e.preventDefault();
          onGitPanel();
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
    onOpenSettings,
    onFind,
    onFindAndReplace,
    onFindNext,
    onFindPrev,
    onInlineEdit,
    onGlobalSearch,
    onGitPanel,
  ]);
}
