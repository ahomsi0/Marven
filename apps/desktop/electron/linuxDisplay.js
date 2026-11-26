// electron/linuxDisplay.js
//
// Pure decision: should Marven run under XWayland instead of native Wayland?
// No Electron imports, so it can be unit-tested.
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
// with `--ozone-platform=x11` on the real command line.

const OZONE_SWITCH = '--ozone-platform';
const XWAYLAND_ARG = `${OZONE_SWITCH}=x11`;

/** A Wayland desktop session (GNOME, KDE, ... on Wayland). */
function isWaylandSession(env) {
  return String(env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' || !!env.WAYLAND_DISPLAY;
}

/** The user (or a launcher) already chose a display backend. */
function hasOzoneChoice(argv, env) {
  const args = Array.isArray(argv) ? argv : [];
  return !!env.ELECTRON_OZONE_PLATFORM_HINT
    || args.some((a) => typeof a === 'string' && /^--ozone-platform(-hint)?(=|$)/.test(a));
}

/**
 * Whether this process should restart itself under XWayland.
 *
 * Linux only; on a Wayland session with an X server to fall back to (DISPLAY
 * is set: XWayland is running or starts on demand); no backend chosen
 * explicitly; Mini Me is on; and the user hasn't opted out with
 * MARVEN_NATIVE_WAYLAND=1.
 *
 * @param {{ platform: string, argv: string[], env: Record<string, string | undefined>, miniMeEnabled: boolean }} input
 */
function shouldUseXWayland({ platform, argv, env, miniMeEnabled }) {
  if (platform !== 'linux' || !miniMeEnabled) return false;
  if (env.MARVEN_NATIVE_WAYLAND === '1') return false;
  if (!isWaylandSession(env) || !env.DISPLAY) return false;
  return !hasOzoneChoice(argv, env);
}

/**
 * Running natively on Wayland when Mini Me would have wanted XWayland: turning
 * Mini Me on now needs a restart before he can move and be clicked.
 */
function needsRestartForMiniMe({ platform, argv, env }) {
  return shouldUseXWayland({ platform, argv, env, miniMeEnabled: true });
}

/** Arguments for the relaunch: the same ones, plus the XWayland switch. */
function xwaylandRelaunchArgs(argv) {
  return [...(Array.isArray(argv) ? argv.slice(1) : []), XWAYLAND_ARG];
}

module.exports = {
  XWAYLAND_ARG,
  isWaylandSession,
  hasOzoneChoice,
  shouldUseXWayland,
  needsRestartForMiniMe,
  xwaylandRelaunchArgs,
};
