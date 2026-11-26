// electron/linuxDisplay.js
//
// Pure decisions: should Marven run under XWayland instead of native Wayland,
// and how to relaunch into it? No Electron imports, so they can be unit-tested.
//
// Electron 41 picks native Wayland (Ozone) on a Wayland desktop. There a window
// can't place itself: BrowserWindow.setPosition / setBounds are ignored, and
// always-on-top and window shapes aren't reliable. Mini Me needs all of those
// (walking, dragging, click-through), so while Mini Me is on, Marven runs as an
// X11 app through XWayland, where they work.
//
// The backend is chosen before main.js runs, so `app.commandLine.appendSwitch(
// 'ozone-platform', 'x11')` from main.js has no effect (Electron's
// command-line-switches docs say so). Instead main.js relaunches itself once
// with `--ozone-platform=x11` on the real command line. Guards, since a bad
// relaunch would stop Marven starting:
// - only with a local X server whose socket exists (XWayland, possibly
//   started on demand), never a remote or missing DISPLAY;
// - never from the relaunched process: RELAUNCH_ENV is set for it (it survives
//   launcher wrappers that rewrite argv), and the switch is on its command line;
// - a marker file (kept by main.js) notices a relaunched process that died
//   before it was ready, and that launch stays on native Wayland.
// ELECTRON_OZONE_PLATFORM_HINT is not an explicit choice: Electron 38 removed it.

const OZONE_SWITCH = '--ozone-platform';
const XWAYLAND_ARG = `${OZONE_SWITCH}=x11`;
/** Set (to "1") for the relaunched process only; main.js deletes it once read. */
const RELAUNCH_ENV = 'MARVEN_XWAYLAND_RELAUNCHED';

/** A Wayland desktop session (GNOME, KDE, ... on Wayland). */
function isWaylandSession(env) {
  return String(env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' || !!env.WAYLAND_DISPLAY;
}

/** The command line already chose a display backend (switches after a bare `--` don't count). */
function hasOzoneChoice(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const end = args.indexOf('--');
  return (end === -1 ? args : args.slice(0, end)).some((a) => typeof a === 'string' && /^--ozone-platform(-hint)?(=|$)/.test(a));
}

/** The display number of a local X display (":0", ":1.0"), else null (remote, malformed, unset). */
function localXDisplayNumber(display) {
  const m = typeof display === 'string' ? /^:(\d+)(\.\d+)?$/.exec(display) : null;
  return m ? Number(m[1]) : null;
}

/** A local X server is reachable: DISPLAY is local and its socket exists. */
function hasLocalXServer(env, exists) {
  const n = localXDisplayNumber(env.DISPLAY);
  if (n === null) return false;
  try {
    return !!exists(`/tmp/.X11-unix/X${n}`);
  } catch {
    return false;
  }
}

/**
 * Relaunching under XWayland is possible and wanted: Linux, a Wayland session
 * with a local X server, no backend chosen on the command line, not the
 * relaunched process itself, and no MARVEN_NATIVE_WAYLAND=1 opt-out.
 *
 * @param {{ platform: string, argv: string[], env: Record<string, string | undefined>, exists: (path: string) => boolean }} input
 */
function canUseXWayland({ platform, argv, env, exists }) {
  if (platform !== 'linux') return false;
  if (env.MARVEN_NATIVE_WAYLAND === '1' || env[RELAUNCH_ENV] === '1') return false;
  if (!isWaylandSession(env) || !hasLocalXServer(env, exists)) return false;
  return !hasOzoneChoice(argv);
}

/**
 * What to do at startup.
 * - relaunch: restart under XWayland now (Mini Me is on).
 * - xwaylandFailed: the last relaunch died before it was ready (its marker is
 *   still there); this launch stays on native Wayland.
 * - needsRestart: running natively on Wayland where XWayland is usable, so
 *   Mini Me, if turned on, has to wait for a restart.
 *
 * @param {{ platform: string, argv: string[], env: Record<string, string | undefined>, exists: (path: string) => boolean, miniMeEnabled: boolean, markerLeft: boolean }} input
 */
function xwaylandStartup({ platform, argv, env, exists, miniMeEnabled, markerLeft }) {
  const xwaylandFailed = platform === 'linux' && !!markerLeft && env[RELAUNCH_ENV] !== '1';
  const usable = !xwaylandFailed && canUseXWayland({ platform, argv, env, exists });
  return { relaunch: usable && !!miniMeEnabled, xwaylandFailed, needsRestart: usable };
}

/**
 * `app.relaunch` options: the switch first (a bare `--` makes Chromium ignore
 * later switches), then the same arguments. A packaged AppImage relaunches the
 * AppImage file: its own binary lives in a mount that goes away on exit.
 *
 * @param {{ argv: string[], env: Record<string, string | undefined>, isPackaged: boolean, execPath: string }} input
 */
function xwaylandRelaunchOptions({ argv, env, isPackaged, execPath }) {
  return {
    args: [XWAYLAND_ARG, ...(Array.isArray(argv) ? argv.slice(1) : [])],
    execPath: isPackaged && env.APPIMAGE ? env.APPIMAGE : execPath,
  };
}

module.exports = {
  XWAYLAND_ARG,
  RELAUNCH_ENV,
  isWaylandSession,
  hasOzoneChoice,
  localXDisplayNumber,
  hasLocalXServer,
  canUseXWayland,
  xwaylandStartup,
  xwaylandRelaunchOptions,
};
