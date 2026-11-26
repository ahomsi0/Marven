import { describe, it, expect } from "vitest";
import { createRequire } from "module";

// linuxDisplay.js is CommonJS (Electron main process).
const require = createRequire(import.meta.url);
type Env = Record<string, string | undefined>;
type Input = { platform: string; argv: string[]; env: Env; miniMeEnabled: boolean };
const L = require("./linuxDisplay") as {
  XWAYLAND_ARG: string;
  isWaylandSession: (env: Env) => boolean;
  hasOzoneChoice: (argv: unknown, env: Env) => boolean;
  shouldUseXWayland: (input: Input) => boolean;
  needsRestartForMiniMe: (input: Omit<Input, "miniMeEnabled">) => boolean;
  xwaylandRelaunchArgs: (argv: unknown) => string[];
};

const gnomeWayland: Env = { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" };
const argv = ["/opt/Marven/marven"];
const base: Input = { platform: "linux", argv, env: gnomeWayland, miniMeEnabled: true };

describe("shouldUseXWayland", () => {
  it("is true on a Linux Wayland session with Mini Me on", () => {
    expect(L.shouldUseXWayland(base)).toBe(true);
  });
  it("detects Wayland from either XDG_SESSION_TYPE or WAYLAND_DISPLAY", () => {
    expect(L.shouldUseXWayland({ ...base, env: { XDG_SESSION_TYPE: "wayland", DISPLAY: ":0" } })).toBe(true);
    expect(L.shouldUseXWayland({ ...base, env: { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" } })).toBe(true);
  });
  it("is false off Linux", () => {
    expect(L.shouldUseXWayland({ ...base, platform: "darwin" })).toBe(false);
    expect(L.shouldUseXWayland({ ...base, platform: "win32" })).toBe(false);
  });
  it("is false with Mini Me off", () => {
    expect(L.shouldUseXWayland({ ...base, miniMeEnabled: false })).toBe(false);
  });
  it("is false on an X11 session", () => {
    expect(L.shouldUseXWayland({ ...base, env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" } })).toBe(false);
  });
  it("is false without an X server to fall back to", () => {
    expect(L.shouldUseXWayland({ ...base, env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" } })).toBe(false);
  });
  it("respects an explicit backend choice", () => {
    expect(L.shouldUseXWayland({ ...base, argv: [...argv, "--ozone-platform=wayland"] })).toBe(false);
    expect(L.shouldUseXWayland({ ...base, argv: [...argv, "--ozone-platform=x11"] })).toBe(false);
    expect(L.shouldUseXWayland({ ...base, argv: [...argv, "--ozone-platform-hint=auto"] })).toBe(false);
    expect(L.shouldUseXWayland({ ...base, env: { ...gnomeWayland, ELECTRON_OZONE_PLATFORM_HINT: "wayland" } })).toBe(false);
  });
  it("doesn't mistake a lookalike argument for a backend choice", () => {
    expect(L.shouldUseXWayland({ ...base, argv: [...argv, "--ozone-platformer"] })).toBe(true);
  });
  it("can be opted out of with MARVEN_NATIVE_WAYLAND=1", () => {
    expect(L.shouldUseXWayland({ ...base, env: { ...gnomeWayland, MARVEN_NATIVE_WAYLAND: "1" } })).toBe(false);
  });
  it("doesn't loop: the relaunched process carries the switch", () => {
    expect(L.shouldUseXWayland({ ...base, argv: [argv[0], ...L.xwaylandRelaunchArgs(argv)] })).toBe(false);
  });
});

describe("needsRestartForMiniMe", () => {
  it("is true when running natively on Wayland", () => {
    expect(L.needsRestartForMiniMe({ platform: "linux", argv, env: gnomeWayland })).toBe(true);
  });
  it("is false once relaunched under XWayland, on X11, or off Linux", () => {
    expect(L.needsRestartForMiniMe({ platform: "linux", argv: [...argv, L.XWAYLAND_ARG], env: gnomeWayland })).toBe(false);
    expect(L.needsRestartForMiniMe({ platform: "linux", argv, env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" } })).toBe(false);
    expect(L.needsRestartForMiniMe({ platform: "darwin", argv, env: gnomeWayland })).toBe(false);
  });
});

describe("xwaylandRelaunchArgs", () => {
  it("keeps the user's arguments and adds the switch", () => {
    expect(L.xwaylandRelaunchArgs(["/opt/Marven/marven", "--no-sandbox"])).toEqual(["--no-sandbox", "--ozone-platform=x11"]);
    expect(L.xwaylandRelaunchArgs(["electron", "."])).toEqual([".", "--ozone-platform=x11"]);
  });
});

describe("isWaylandSession", () => {
  it("is case-insensitive on XDG_SESSION_TYPE", () => {
    expect(L.isWaylandSession({ XDG_SESSION_TYPE: "Wayland" })).toBe(true);
    expect(L.isWaylandSession({})).toBe(false);
  });
});
