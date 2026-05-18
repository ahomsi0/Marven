"use client";

// Real interactive terminal backed by node-pty in the Electron main process.
// xterm.js renders the UI; keystrokes go to the main process via IPC; output
// streams back. One PTY per workspace (`ptyId`) — switching workspaces remounts
// this component, which kills the old PTY and spawns a new shell in the new cwd.

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  ptyId: string;   // stable id per workspace
  cwd: string;     // initial working directory for the shell
  theme: "dark" | "light";
}

// xterm theme objects — colors map to the Marven palette where possible.
// The accent (#d19a66) shows up in the selection wash so the terminal still
// feels part of the app.
const DARK_THEME = {
  background: "#1a1a1a",
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  cursorAccent: "#1a1a1a",
  selectionBackground: "rgba(209,154,102,0.3)",
};

const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#1f1f1f",
  cursor: "#1f1f1f",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(209,154,102,0.3)",
};

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
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // We intentionally remount the PTY when ptyId or cwd changes — different
  // workspace ⇒ different shell. Theme is handled in a separate effect so
  // toggling it doesn't kill the running shell.
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
      scrollback: 5000,
      allowProposedApi: true,
      theme: theme === "light" ? LIGHT_THEME : DARK_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    // Run fit on the next frame — opening synchronously can leave the
    // container without measured layout, which makes fit.fit() throw.
    requestAnimationFrame(() => {
      try { fit.fit(); } catch {}
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
      ro.disconnect();
      try { keyDisposable.dispose(); } catch {}
      try { resizeDisposable.dispose(); } catch {}
      unsubData?.();
      unsubExit?.();
      try { bridge.ptyKill({ id: ptyId }); } catch {}
      try { term.dispose(); } catch {}
      termRef.current = null;
      fitRef.current = null;
    };
    // ptyId / cwd remount = fresh shell. Theme is handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptyId, cwd]);

  // Theme swap — apply colors without recreating the terminal.
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    t.options.theme = theme === "light" ? LIGHT_THEME : DARK_THEME;
  }, [theme]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      style={{
        // xterm renders against its own theme; this background fills any gap
        // before xterm mounts so we don't flash the panel's surface color.
        background: theme === "light" ? LIGHT_THEME.background : DARK_THEME.background,
      }}
    />
  );
}
