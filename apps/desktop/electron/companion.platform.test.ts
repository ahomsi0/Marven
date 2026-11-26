import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "module";

// companion.js is CommonJS and requires "electron". Load it against a fake
// Electron, with process.platform faked, to check which click-through path each
// platform takes. (Nothing here runs a real window.)
const require = createRequire(import.meta.url);
type Rect = { x: number; y: number; width: number; height: number };

function fakeElectron() {
  const calls: { method: string; args: unknown[] }[] = [];
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const screenHandlers: { event: string; fn: (...args: unknown[]) => unknown }[] = [];
  const shortcuts: string[] = [];
  let win: FakeWindow | null = null;
  class FakeWindow {
    pos: [number, number];
    webContents = {
      id: 7,
      on() {},
      setWindowOpenHandler() {},
      send() {},
      getURL: () => "",
      focus: () => calls.push({ method: "webContents.focus", args: [] }),
    };
    constructor(opts: { x: number; y: number }) {
      calls.push({ method: "constructor", args: [opts] });
      this.pos = [opts.x, opts.y];
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      win = this;
    }
    private record(method: string, args: unknown[]) {
      calls.push({ method, args });
    }
    setAlwaysOnTop(...a: unknown[]) { this.record("setAlwaysOnTop", a); }
    setVisibleOnAllWorkspaces(...a: unknown[]) { this.record("setVisibleOnAllWorkspaces", a); }
    setIgnoreMouseEvents(...a: unknown[]) { this.record("setIgnoreMouseEvents", a); }
    setShape(...a: unknown[]) { this.record("setShape", a); }
    setFocusable(...a: unknown[]) { this.record("setFocusable", a); }
    setSkipTaskbar(...a: unknown[]) { this.record("setSkipTaskbar", a); }
    focus() { this.record("focus", []); }
    blur() { this.record("blur", []); }
    setBounds(b: Rect) { this.record("setBounds", [b]); this.pos = [b.x, b.y]; }
    setPosition(x: number, y: number) { this.pos = [x, y]; }
    getPosition() { return this.pos; }
    isDestroyed() { return false; }
    isVisible() { return true; }
    showInactive() {}
    loadURL() {}
    on() {}
    destroy() {}
  }
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const electron = {
    BrowserWindow: FakeWindow,
    screen: {
      getAllDisplays: () => [display],
      getPrimaryDisplay: () => display,
      on: (event: string, fn: (...args: unknown[]) => unknown) => screenHandlers.push({ event, fn }),
    },
    globalShortcut: { register: (accel: string) => (shortcuts.push(accel), true), unregister() {} },
    ipcMain: {
      handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn),
      on: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn),
    },
    clipboard: { readText: () => "" },
    shell: {},
  };
  return {
    electron,
    calls,
    win: () => win,
    shortcuts,
    emitScreen: (event: string, ...args: unknown[]) => screenHandlers.filter((h) => h.event === event).forEach((h) => h.fn({}, ...args)),
    send: (ch: string, ...args: unknown[]) => handlers.get(ch)!({ sender: win!.webContents }, ...args),
  };
}

const electronPath = require.resolve("electron");
const companionPath = require.resolve("./companion");
const realPlatform = process.platform;

function loadCompanion(platform: NodeJS.Platform, options: { nativeWayland?: boolean; xwaylandFailed?: boolean } = {}) {
  const fake = fakeElectron();
  Object.defineProperty(process, "platform", { value: platform });
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake.electron } as unknown as NodeJS.Module;
  delete require.cache[companionPath];
  const { createCompanion } = require("./companion");
  const companion = createCompanion({ appPort: 1, savePosition() {}, ...options });
  return { ...fake, companion };
}

afterEach(() => {
  Object.defineProperty(process, "platform", { value: realPlatform });
  delete require.cache[electronPath];
  delete require.cache[companionPath];
});

const shapes = (calls: { method: string; args: unknown[] }[]) => calls.filter((c) => c.method === "setShape").map((c) => c.args[0] as Rect[]);

describe("companion click-through by platform", () => {
  it("macOS: forwarded mouse events, no shape, hit rects ignored", () => {
    const { calls, send, companion } = loadCompanion("darwin");
    companion.applySettings({ miniMeEnabled: true, miniMeScale: 3, miniMeLook: { artStyle: "chibi" } });
    expect(calls.filter((c) => c.method === "setIgnoreMouseEvents").map((c) => c.args)).toEqual([[true, { forward: true }]]);
    send("companion:set-interactive", true);
    expect(calls.filter((c) => c.method === "setIgnoreMouseEvents").at(-1)!.args).toEqual([false, { forward: true }]);
    send("companion:set-hit-rects", [{ x: 0, y: 0, width: 10, height: 10 }]);
    expect(shapes(calls)).toEqual([]);
    expect(companion.status().needsRestartForLinux).toBe(false);
  });

  it("Linux: a window shape around the sprite, then the page's rects; set-interactive is a no-op", () => {
    const { calls, send, companion } = loadCompanion("linux");
    companion.applySettings({ miniMeEnabled: true, miniMeScale: 3, miniMeLook: { artStyle: "chibi" } });
    expect(calls.some((c) => c.method === "setIgnoreMouseEvents")).toBe(false);
    // Window 360×280 (chibi at 3×: a 96-px sprite): the default sprite box, padded by 8.
    expect(shapes(calls)).toEqual([[{ x: 124, y: 176, width: 112, height: 104 }]]);

    send("companion:set-interactive", true);
    expect(calls.some((c) => c.method === "setIgnoreMouseEvents")).toBe(false);

    send("companion:set-hit-rects", [
      { x: 20, y: 40, width: 320, height: 120 },
      { x: 132, y: 184, width: 96, height: 96 },
    ]);
    expect(shapes(calls).at(-1)).toEqual([
      { x: 12, y: 32, width: 336, height: 136 },
      { x: 124, y: 176, width: 112, height: 104 },
    ]);
    // The same rects again: no extra setShape.
    const count = shapes(calls).length;
    send("companion:set-hit-rects", [
      { x: 20, y: 40, width: 320, height: 120 },
      { x: 132, y: 184, width: 96, height: 96 },
    ]);
    expect(shapes(calls).length).toBe(count);
    // Garbage falls back to the sprite box rather than an empty (invisible) shape.
    send("companion:set-hit-rects", "nope");
    expect(shapes(calls).at(-1)).toEqual([{ x: 124, y: 176, width: 112, height: 104 }]);
    expect(companion.status().needsRestartForLinux).toBe(false);
  });

  it("Linux: a display scale change re-applies the same shape; other metric changes don't", () => {
    const { calls, send, companion, emitScreen } = loadCompanion("linux");
    companion.applySettings({ miniMeEnabled: true, miniMeScale: 3, miniMeLook: { artStyle: "chibi" } });
    send("companion:set-hit-rects", [{ x: 132, y: 184, width: 96, height: 96 }]);
    const count = shapes(calls).length;
    emitScreen("display-metrics-changed", {}, ["workArea"]);
    expect(shapes(calls).length).toBe(count);
    emitScreen("display-metrics-changed", {}, ["scaleFactor"]);
    expect(shapes(calls).length).toBe(count + 1);
    expect(shapes(calls).at(-1)).toEqual(shapes(calls).at(-2));
  });

  it("Linux, native Wayland: no window or hotkey until a restart, and status says so", () => {
    const { calls, companion, shortcuts } = loadCompanion("linux", { nativeWayland: true });
    companion.applySettings({ miniMeEnabled: false });
    expect(companion.status().needsRestartForLinux).toBe(false);
    companion.applySettings({ miniMeEnabled: true, miniMeHotkey: "CommandOrControl+Shift+Space" });
    expect(calls.some((c) => c.method === "constructor")).toBe(false);
    expect(shortcuts).toEqual([]);
    expect(companion.status()).toMatchObject({ visible: false, needsRestartForLinux: true, xwaylandFailed: false });
  });

  it("Linux, XWayland failed to start: Mini Me shows anyway and status says why he can't move", () => {
    const { calls, companion } = loadCompanion("linux", { xwaylandFailed: true });
    companion.applySettings({ miniMeEnabled: true });
    expect(calls.some((c) => c.method === "constructor")).toBe(true);
    expect(companion.status()).toMatchObject({ needsRestartForLinux: false, xwaylandFailed: true });
    companion.applySettings({ miniMeEnabled: false });
    expect(companion.status().xwaylandFailed).toBe(false);
  });

  it("Linux: resizing the window resets the shape to the new sprite box", () => {
    const { calls, send, companion } = loadCompanion("linux");
    companion.applySettings({ miniMeEnabled: true, miniMeScale: 3, miniMeLook: { artStyle: "chibi" } });
    send("companion:set-hit-rects", [{ x: 20, y: 40, width: 320, height: 120 }]);
    companion.applySettings({ miniMeEnabled: true, miniMeScale: 4, miniMeLook: { artStyle: "chibi" } });
    // 360×312 (128-px sprite).
    expect(shapes(calls).at(-1)).toEqual([{ x: 108, y: 176, width: 144, height: 136 }]);
  });

  it("macOS: built non-focusable; set-focusable toggles focusability, never blur()", () => {
    const { calls, send, companion } = loadCompanion("darwin");
    companion.applySettings({ miniMeEnabled: true });
    expect((constructorOptions(calls) as { focusable: boolean }).focusable).toBe(false);
    expect((constructorOptions(calls) as { skipTaskbar: boolean }).skipTaskbar).toBe(true);
    send("companion:set-focusable", true);
    expect(focusCalls(calls)).toEqual(["setFocusable:true", "focus"]);
    send("companion:set-focusable", false);
    expect(focusCalls(calls)).toEqual(["setFocusable:true", "focus", "setFocusable:false"]);
  });

  it("Windows: unchanged, set-focusable(false) blurs", () => {
    const { calls, send, companion } = loadCompanion("win32");
    companion.applySettings({ miniMeEnabled: true });
    expect((constructorOptions(calls) as { focusable: boolean }).focusable).toBe(false);
    send("companion:set-focusable", false);
    expect(focusCalls(calls)).toEqual(["setFocusable:false", "blur"]);
  });

  it("Linux: built focusable; set-focusable(true) focuses the window and page, false leaves focus alone", () => {
    const { calls, send, companion } = loadCompanion("linux");
    companion.applySettings({ miniMeEnabled: true });
    const opts = constructorOptions(calls) as { focusable: boolean; skipTaskbar: boolean };
    expect(opts.focusable).toBe(true);
    expect(opts.skipTaskbar).toBe(true);
    expect(calls.some((c) => c.method === "setAlwaysOnTop")).toBe(true);
    expect(calls.some((c) => c.method === "setVisibleOnAllWorkspaces")).toBe(true);
    send("companion:set-focusable", true);
    expect(focusCalls(calls)).toEqual(["focus", "webContents.focus"]);
    send("companion:set-focusable", false);
    expect(focusCalls(calls)).toEqual(["focus", "webContents.focus"]);
  });
});

function constructorOptions(calls: { method: string; args: unknown[] }[]) {
  return calls.find((c) => c.method === "constructor")!.args[0];
}

function focusCalls(calls: { method: string; args: unknown[] }[]) {
  return calls
    .filter((c) => ["setFocusable", "focus", "blur", "webContents.focus"].includes(c.method))
    .map((c) => (c.method === "setFocusable" ? `setFocusable:${c.args[0]}` : c.method));
}
