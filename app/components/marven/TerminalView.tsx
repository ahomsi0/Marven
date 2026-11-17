"use client";

// Real interactive terminal backed by node-pty in the Electron main process.
// xterm.js renders the UI; keystrokes go to the main process via IPC; output
// streams back. One PTY per workspace (`ptyId`) — switching workspaces remounts
// this component, which kills the old PTY and spawns a new shell in the new cwd.

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Theme } from "@/lib/theme";
import { resolveTerminalTheme } from "@/lib/terminal/themes";
import {
  getTerminalSettings,
  terminalFontStack,
  useTerminalSettings,
  type TerminalSettings,
} from "@/lib/terminal/terminalSettings";

interface TerminalViewProps {
  ptyId: string;   // stable id per workspace
  cwd: string;     // initial working directory for the shell
  theme: Theme;
}

// xterm options derived from the terminal settings and the app theme.
// "Match app theme" resolves to Marven's own scheme for the current app theme.
function xtermOptions(settings: TerminalSettings, appTheme: Theme) {
  return {
    theme: resolveTerminalTheme(settings.theme, appTheme).colors,
    fontFamily: terminalFontStack(settings.fontFamily),
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    cursorStyle: settings.cursorStyle,
    cursorBlink: settings.cursorBlink,
  };
}

// Narrow interface for the preload bridge. We type-check against this at the
// call site so TS catches typos without bloating window typings globally.
interface PtyBridge {
  ptyStart: (args: { id: string; cwd: string; cols: number; rows: number }) => Promise<{ ok: boolean; error?: string }>;
  ptyWrite: (args: { id: string; data: string }) => void;
  ptyResize: (args: { id: string; cols: number; rows: number }) => void;
  ptyKill: (args: { id: string }) => void;
  onPtyData: (cb: (msg: { id: string; data: string }) => void) => () => void;
  onPtyExit: (cb: (msg: { id: string; exitCode: number }) => void) => () => void;
}

function getPtyBridge(): PtyBridge | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (window as any).marvenElectron as Partial<PtyBridge> | undefined;
  if (!el || typeof el.ptyStart !== "function") return null;
  return el as PtyBridge;
}

export function TerminalView({ ptyId, cwd, theme }: TerminalViewProps) {
  const settings = useTerminalSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // We intentionally remount the PTY when ptyId or cwd changes — different
  // workspace ⇒ different shell. Theme is handled in a separate effect so
  // toggling it doesn't kill the running shell.
  useEffect(() => {
    if (!containerRef.current) return;

    // Read settings directly (not from the hook's state) so the very first
    // frame already uses them instead of flashing the defaults.
    const term = new Terminal({
      ...xtermOptions(getTerminalSettings(), theme),
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    // Run fit on the next frame — opening synchronously can leave the
    // container without measured layout, which makes fit.fit() throw.
    // Focus afterwards so keystrokes reach the PTY without an extra click;
    // without this xterm's hidden textarea may not be the active element when
    // the panel opens, so typing goes wherever the editor focus was.
    const rafId = requestAnimationFrame(() => {
      try { fit.fit(); } catch {}
      try { term.focus(); } catch {}
    });
    termRef.current = term;
    fitRef.current = fit;

    const bridge = getPtyBridge();
    if (!bridge) {
      term.write("\r\n\x1b[2m[Marven] PTY not available (Electron bridge missing).\x1b[0m\r\n");
      return () => {
        try { term.dispose(); } catch {}
        termRef.current = null;
        fitRef.current = null;
      };
    }

    let unsubData: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;
    let disposed = false;

    bridge
      .ptyStart({
        id: ptyId,
        cwd,
        cols: term.cols || 80,
        rows: term.rows || 24,
      })
      .then((res) => {
        if (disposed) return;
        if (!res || !res.ok) {
          term.write(`\r\n\x1b[31m[Marven] Failed to start PTY: ${res?.error || "unknown"}\x1b[0m\r\n`);
          return;
        }
        unsubData = bridge.onPtyData((msg) => {
          if (msg.id === ptyId) term.write(msg.data);
        });
        unsubExit = bridge.onPtyExit((msg) => {
          if (msg.id === ptyId) {
            term.write(`\r\n\x1b[2m[process exited: ${msg.exitCode}]\x1b[0m\r\n`);
          }
        });
      })
      .catch((err) => {
        if (disposed) return;
        term.write(`\r\n\x1b[31m[Marven] PTY error: ${String(err)}\x1b[0m\r\n`);
      });

    // Forward keystrokes → PTY
    const keyDisposable = term.onData((data) => {
      bridge.ptyWrite({ id: ptyId, data });
    });

    // Defensive: refocus xterm's hidden textarea if it loses focus to a sibling
    // element. Without this, clicking near the terminal can leave keystrokes
    // landing on the editor or sidebar instead of the shell.
    const onContainerKeyDown = () => {
      const ta = containerRef.current?.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement | null;
      const isInTerm = ta && (document.activeElement === ta || containerRef.current?.contains(document.activeElement));
      if (!isInTerm) {
        try { ta?.focus(); } catch {}
      }
    };
    containerRef.current.addEventListener("keydown", onContainerKeyDown);

    // Forward terminal resize → PTY (so the shell's $COLUMNS/$LINES match)
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      bridge.ptyResize({ id: ptyId, cols, rows });
    });

    // Refit when the container resizes. ResizeObserver is debounced enough by
    // the browser that we don't need extra throttling here.
    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch {}
    });
    ro.observe(containerRef.current);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      containerRef.current?.removeEventListener("keydown", onContainerKeyDown);
      try { keyDisposable.dispose(); } catch {}
      try { resizeDisposable.dispose(); } catch {}
      unsubData?.();
      unsubExit?.();
      // Deliberately do NOT kill the PTY here. Unmounting happens on panel
      // collapse / tab switches too — killing would terminate running
      // processes (dev servers, watches). The shell stays alive in the main
      // process keyed by ptyId; a remount reuses it and replays buffered
      // output. Shells are reaped on app quit or via the main-process LRU cap.
      try { term.dispose(); } catch {}
      termRef.current = null;
      fitRef.current = null;
    };
    // ptyId / cwd remount = fresh shell. Theme is handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptyId, cwd]);

  // Settings or app theme changed — update the running terminal in place so
  // the shell keeps running. Font changes alter the cell size, so re-fit on the
  // next frame and again once any newly chosen font has finished loading.
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    const next = xtermOptions(settings, theme);
    const fontChanged =
      t.options.fontFamily !== next.fontFamily ||
      t.options.fontSize !== next.fontSize ||
      t.options.lineHeight !== next.lineHeight;
    t.options.theme = next.theme;
    t.options.fontFamily = next.fontFamily;
    t.options.fontSize = next.fontSize;
    t.options.lineHeight = next.lineHeight;
    t.options.cursorStyle = next.cursorStyle;
    t.options.cursorBlink = next.cursorBlink;
    if (!fontChanged) return;

    let cancelled = false;
    const refit = () => {
      if (cancelled) return;
      try { fitRef.current?.fit(); } catch {}
    };
    const raf = requestAnimationFrame(refit);
    document.fonts?.ready.then(refit).catch(() => {});
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [settings, theme]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      onMouseDown={() => {
        // Refocus xterm on any click in the panel — keeps "click terminal,
        // start typing" working even after focus drifts to the editor or sidebar.
        try { termRef.current?.focus(); } catch {}
      }}
      style={{
        // xterm renders against its own theme; this background fills any gap
        // before xterm mounts so we don't flash the panel's surface color.
        background: resolveTerminalTheme(settings.theme, theme).colors.background,
      }}
    />
  );
}
