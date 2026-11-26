import { describe, it, expect } from "vitest";
import { createRequire } from "module";

// linuxDisplay.js is CommonJS (Electron main process).
const require = createRequire(import.meta.url);
type Env = Record<string, string | undefined>;
type Exists = (p: string) => boolean;
type Input = { platform: string; argv: string[]; env: Env; exists: Exists };
type StartupInput = Input & { miniMeEnabled: boolean; markerLeft: boolean };
const L = require("./linuxDisplay") as {
  XWAYLAND_ARG: string;
  RELAUNCH_ENV: string;
  isWaylandSession: (env: Env) => boolean;
  hasOzoneChoice: (argv: unknown) => boolean;
  localXDisplayNumber: (display: unknown) => number | null;
  hasLocalXServer: (env: Env, exists: Exists) => boolean;
  canUseXWayland: (input: Input) => boolean;
  xwaylandStartup: (input: StartupInput) => { relaunch: boolean; xwaylandFailed: boolean; needsRestart: boolean };
  xwaylandRelaunchOptions: (input: { argv: string[]; env: Env; isPackaged: boolean; execPath: string }) => { args: string[]; execPath: string };
};

const gnomeWayland: Env = { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" };
const argv = ["/opt/Marven/marven"];
// Only the X0 socket exists, as under GNOME's XWayland.
const exists: Exists = (p) => p === "/tmp/.X11-unix/X0";
const base: Input = { platform: "linux", argv, env: gnomeWayland, exists };
const startup = (over: Partial<StartupInput> = {}) => L.xwaylandStartup({ ...base, miniMeEnabled: true, markerLeft: false, ...over });

describe("localXDisplayNumber", () => {
  it("accepts local displays only", () => {
    expect(L.localXDisplayNumber(":0")).toBe(0);
    expect(L.localXDisplayNumber(":1")).toBe(1);
    expect(L.localXDisplayNumber(":12.0")).toBe(12);
    expect(L.localXDisplayNumber("localhost:10.0")).toBeNull();
    expect(L.localXDisplayNumber("host:0")).toBeNull();
    expect(L.localXDisplayNumber("/tmp/launch-abc/org.xquartz:0")).toBeNull();
    expect(L.localXDisplayNumber(":")).toBeNull();
    expect(L.localXDisplayNumber(":0x")).toBeNull();
    expect(L.localXDisplayNumber("")).toBeNull();
    expect(L.localXDisplayNumber(undefined)).toBeNull();
  });
});

describe("hasLocalXServer", () => {
  it("needs the display's socket in /tmp/.X11-unix", () => {
    expect(L.hasLocalXServer({ DISPLAY: ":0" }, exists)).toBe(true);
    expect(L.hasLocalXServer({ DISPLAY: ":1" }, exists)).toBe(false);
    expect(L.hasLocalXServer({ DISPLAY: "remote:0" }, () => true)).toBe(false);
    expect(L.hasLocalXServer({}, () => true)).toBe(false);
  });
});

describe("canUseXWayland", () => {
  it("is true on a Linux Wayland session with a local X server", () => {
    expect(L.canUseXWayland(base)).toBe(true);
  });
  it("detects Wayland from either XDG_SESSION_TYPE or WAYLAND_DISPLAY", () => {
    expect(L.canUseXWayland({ ...base, env: { XDG_SESSION_TYPE: "wayland", DISPLAY: ":0" } })).toBe(true);
    expect(L.canUseXWayland({ ...base, env: { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" } })).toBe(true);
  });
  it("is false off Linux", () => {
    expect(L.canUseXWayland({ ...base, platform: "darwin" })).toBe(false);
    expect(L.canUseXWayland({ ...base, platform: "win32" })).toBe(false);
  });
  it("is false on an X11 session", () => {
    expect(L.canUseXWayland({ ...base, env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" } })).toBe(false);
  });
  it("is false without a reachable local X server", () => {
    expect(L.canUseXWayland({ ...base, env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" } })).toBe(false);
    expect(L.canUseXWayland({ ...base, env: { ...gnomeWayland, DISPLAY: ":1" } })).toBe(false);
    expect(L.canUseXWayland({ ...base, env: { ...gnomeWayland, DISPLAY: "localhost:10.0" } })).toBe(false);
    expect(L.canUseXWayland({ ...base, exists: () => false })).toBe(false);
  });
  it("respects an explicit backend choice on the command line", () => {
    expect(L.canUseXWayland({ ...base, argv: [...argv, "--ozone-platform=wayland"] })).toBe(false);
    expect(L.canUseXWayland({ ...base, argv: [...argv, "--ozone-platform=x11"] })).toBe(false);
    expect(L.canUseXWayland({ ...base, argv: [...argv, "--ozone-platform-hint=auto"] })).toBe(false);
  });
  it("ignores ELECTRON_OZONE_PLATFORM_HINT (removed in Electron 38)", () => {
    expect(L.canUseXWayland({ ...base, env: { ...gnomeWayland, ELECTRON_OZONE_PLATFORM_HINT: "wayland" } })).toBe(true);
  });
  it("doesn't mistake a lookalike argument for a backend choice", () => {
    expect(L.canUseXWayland({ ...base, argv: [...argv, "--ozone-platformer"] })).toBe(true);
  });
  it("can be opted out of with MARVEN_NATIVE_WAYLAND=1", () => {
    expect(L.canUseXWayland({ ...base, env: { ...gnomeWayland, MARVEN_NATIVE_WAYLAND: "1" } })).toBe(false);
  });
  it("is false in the relaunched process, even if a wrapper dropped the switch", () => {
    expect(L.canUseXWayland({ ...base, env: { ...gnomeWayland, [L.RELAUNCH_ENV]: "1" } })).toBe(false);
  });
});

describe("xwaylandStartup", () => {
  it("relaunches when Mini Me is on and XWayland is usable", () => {
    expect(startup()).toEqual({ relaunch: true, xwaylandFailed: false, needsRestart: true });
  });
  it("stays native with Mini Me off, but turning him on will need a restart", () => {
    expect(startup({ miniMeEnabled: false })).toEqual({ relaunch: false, xwaylandFailed: false, needsRestart: true });
  });
  it("doesn't loop: the relaunched process (env flag or switch) stays put", () => {
    expect(startup({ env: { ...gnomeWayland, [L.RELAUNCH_ENV]: "1" } })).toEqual({ relaunch: false, xwaylandFailed: false, needsRestart: false });
    const opts = L.xwaylandRelaunchOptions({ argv, env: {}, isPackaged: true, execPath: argv[0] });
    expect(startup({ argv: [opts.execPath, ...opts.args] }).relaunch).toBe(false);
  });
  it("the relaunched process doesn't mistake its own marker for a failure", () => {
    expect(startup({ env: { ...gnomeWayland, [L.RELAUNCH_ENV]: "1" }, markerLeft: true }).xwaylandFailed).toBe(false);
  });
  it("skips XWayland for this launch when the last relaunch died before ready", () => {
    expect(startup({ markerLeft: true })).toEqual({ relaunch: false, xwaylandFailed: true, needsRestart: false });
  });
  it("never relaunches or reports anything off Linux", () => {
    expect(startup({ platform: "darwin", markerLeft: true })).toEqual({ relaunch: false, xwaylandFailed: false, needsRestart: false });
  });
  it("on X11 or without a local X server: nothing to do", () => {
    expect(startup({ env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" } })).toEqual({ relaunch: false, xwaylandFailed: false, needsRestart: false });
    expect(startup({ exists: () => false })).toEqual({ relaunch: false, xwaylandFailed: false, needsRestart: false });
  });
});

describe("xwaylandRelaunchOptions", () => {
  it("packaged AppImage: relaunches the AppImage file, switch first, user args kept", () => {
    expect(
      L.xwaylandRelaunchOptions({
        argv: ["/tmp/.mount_MarvenX/marven", "--no-sandbox"],
        env: { APPIMAGE: "/home/me/Apps/Marven.AppImage" },
        isPackaged: true,
        execPath: "/tmp/.mount_MarvenX/marven",
      }),
    ).toEqual({ execPath: "/home/me/Apps/Marven.AppImage", args: ["--ozone-platform=x11", "--no-sandbox"] });
  });
  it("dev (`electron .`): same executable, APPIMAGE ignored when not packaged", () => {
    expect(
      L.xwaylandRelaunchOptions({ argv: ["/repo/node_modules/electron/dist/electron", "."], env: { APPIMAGE: "/x.AppImage" }, isPackaged: false, execPath: "/repo/node_modules/electron/dist/electron" }),
    ).toEqual({ execPath: "/repo/node_modules/electron/dist/electron", args: ["--ozone-platform=x11", "."] });
  });
  it("puts the switch before a bare `--` (Chromium ignores switches after it)", () => {
    expect(L.xwaylandRelaunchOptions({ argv: ["/opt/m", ".", "--", "--ozone-platform=wayland", "file"], env: {}, isPackaged: true, execPath: "/opt/m" }).args).toEqual([
      "--ozone-platform=x11",
      ".",
      "--",
      "--ozone-platform=wayland",
      "file",
    ]);
  });
});

describe("hasOzoneChoice", () => {
  it("ignores arguments after a bare `--`", () => {
    expect(L.hasOzoneChoice(["/opt/m", "--", "--ozone-platform=x11"])).toBe(false);
    expect(L.hasOzoneChoice(["/opt/m", "--ozone-platform=x11", "--"])).toBe(true);
  });
});

describe("isWaylandSession", () => {
  it("is case-insensitive on XDG_SESSION_TYPE", () => {
    expect(L.isWaylandSession({ XDG_SESSION_TYPE: "Wayland" })).toBe(true);
    expect(L.isWaylandSession({})).toBe(false);
  });
});
