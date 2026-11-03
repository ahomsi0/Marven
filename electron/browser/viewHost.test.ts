import { describe, it, expect, beforeEach, vi } from "vitest";
import { createViewHost } from "./viewHost.js";

type Bounds = { x: number; y: number; width: number; height: number };

function fakeView() {
  const view = {
    visible: true,
    muted: false,
    bounds: { x: 0, y: 0, width: 0, height: 0 } as Bounds,
    setVisible: (visible: boolean) => { view.visible = visible; },
    setBounds: (b: Bounds) => { view.bounds = b; },
    getBounds: () => view.bounds,
    webContents: {
      isDestroyed: () => false,
      isAudioMuted: () => view.muted,
      setAudioMuted: (muted: boolean) => { view.muted = muted; },
      capturePage: vi.fn(),
    },
  };
  return view;
}
type View = ReturnType<typeof fakeView>;

function fakeWindow() {
  const children: View[] = [];
  const listeners = new Map<string, () => void>();
  return {
    destroyed: false,
    fullScreen: false,
    size: [1200, 800] as [number, number],
    listeners,
    isDestroyed() { return this.destroyed; },
    getContentSize() { return this.size; },
    isFullScreen() { return this.fullScreen; },
    setFullScreen(on: boolean) { this.fullScreen = on; },
    on(event: string, fn: () => void) { listeners.set(event, fn); },
    off(event: string, fn: () => void) { if (listeners.get(event) === fn) listeners.delete(event); },
    contentView: {
      children,
      addChildView: (v: View) => { children.push(v); },
      removeChildView: (v: View) => { children.splice(children.indexOf(v), 1); },
    },
  };
}

function fakeImage({ empty = false } = {}) {
  const image = {
    isEmpty: () => empty,
    resize: vi.fn(() => image),
    toJPEG: vi.fn(() => Buffer.from("jpeg")),
  };
  return image;
}

const BOUNDS = { x: 10, y: 20, width: 800, height: 600 };

let win: ReturnType<typeof fakeWindow> | null;
let views: View[];
let showable: boolean;
let host: ReturnType<typeof createViewHost>;

beforeEach(() => {
  win = fakeWindow();
  views = [fakeView(), fakeView()];
  showable = true;
  host = createViewHost({ getWindow: () => win as never, getPage: () => ({ showable, views: views as never }) });
});

// The panel shown with views[0] on screen.
function showFirst() {
  host.show(BOUNDS);
  host.showActive(views[0] as never);
}

describe("createViewHost", () => {
  it("attaches the active view at the panel's bounds and mutes the rest", () => {
    showFirst();
    expect(win!.contentView.children).toEqual([views[0]]);
    expect(host.isAttached(views[0] as never)).toBe(true);
    expect(views[0].bounds).toEqual(BOUNDS);
    expect(views[0].visible).toBe(true);
    expect(views[0].muted).toBe(false);
    expect(views[1].muted).toBe(true);
  });

  it("swaps views, hiding and muting the one it takes off", () => {
    showFirst();
    host.showActive(views[1] as never);
    expect(win!.contentView.children).toEqual([views[1]]);
    expect(views[0].visible).toBe(false);
    expect(views[0].muted).toBe(true);
    expect(views[1].visible).toBe(true);
    expect(views[1].muted).toBe(false);
  });

  it("detaches everything when given no view", () => {
    showFirst();
    host.showActive(null as never);
    expect(win!.contentView.children).toEqual([]);
    expect(host.isAttached(views[0] as never)).toBe(false);
    expect(host.isAttached(null as never)).toBe(false);
  });

  it("does nothing without a live window", () => {
    win!.destroyed = true;
    expect(host.hasWindow()).toBe(false);
    host.show(BOUNDS);
    host.showActive(views[0] as never);
    expect(host.isAttached(views[0] as never)).toBe(false);
    win = null;
    expect(host.hasWindow()).toBe(false);
  });

  it("follows bounds changes", () => {
    showFirst();
    const next = { ...BOUNDS, width: 400 };
    host.setBounds(next);
    expect(views[0].bounds).toEqual(next);
  });

  it("hides and mutes the page while the panel is hidden, keeping it attached", () => {
    showFirst();
    host.hide();
    expect(host.isShown()).toBe(false);
    expect(views[0].visible).toBe(false);
    expect(views[0].muted).toBe(true);
    expect(host.isAttached(views[0] as never)).toBe(true);
  });

  it("hides a page that can't be shown (an error page) without muting it", () => {
    showFirst();
    showable = false;
    host.syncVisibility();
    expect(views[0].visible).toBe(false);
    expect(views[0].muted).toBe(false);
  });

  it("ignores missing views when muting", () => {
    views = [views[0], null as never];
    showFirst();
    expect(views[0].muted).toBe(false);
  });

  it("detaches on request, hiding and muting the view", () => {
    showFirst();
    host.detach();
    expect(win!.contentView.children).toEqual([]);
    expect(views[0].visible).toBe(false);
    expect(views[0].muted).toBe(true);
  });

  it("forgets the view and the panel when the window closes", () => {
    showFirst();
    host.windowClosed();
    expect(host.isAttached(views[0] as never)).toBe(false);
    expect(host.isShown()).toBe(false);
  });

  describe("fullscreen", () => {
    it("covers the whole window and puts the view back after", () => {
      showFirst();
      host.setFullscreen(true);
      expect(host.isFullscreen()).toBe(true);
      expect(views[0].bounds).toEqual({ x: 0, y: 0, width: 1200, height: 800 });

      host.setFullscreen(false);
      expect(host.isFullscreen()).toBe(false);
      expect(views[0].bounds).toEqual(BOUNDS);
    });

    it("follows the window as it grows, ignoring the panel's bounds", () => {
      showFirst();
      host.setFullscreen(true);
      win!.size = [1440, 900];
      win!.listeners.get("resize")!();
      expect(views[0].bounds).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
      host.setBounds({ ...BOUNDS, width: 300 });
      expect(views[0].bounds).toEqual({ x: 0, y: 0, width: 1440, height: 900 });

      host.setFullscreen(false);
      expect(win!.listeners.has("resize")).toBe(false);
      expect(views[0].bounds).toEqual({ ...BOUNDS, width: 300 });
    });

    it("leaves the window's own fullscreen state to Electron", () => {
      showFirst();
      host.setFullscreen(true);
      expect(win!.fullScreen).toBe(false);
      win!.fullScreen = true;
      host.setFullscreen(false);
      expect(win!.fullScreen).toBe(true);
    });

    it("places a view attached while fullscreen over the whole window", () => {
      showFirst();
      host.setFullscreen(true);
      host.showActive(views[1] as never);
      expect(views[1].bounds).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
    });
  });

  describe("freeze", () => {
    it("returns the page as a JPEG at the view's size and hides the view, still audible", async () => {
      showFirst();
      const image = fakeImage();
      views[0].webContents.capturePage.mockResolvedValue(image);
      await expect(host.freeze()).resolves.toBe(`data:image/jpeg;base64,${Buffer.from("jpeg").toString("base64")}`);
      expect(image.resize).toHaveBeenCalledWith({ width: 800, height: 600 });
      expect(image.toJPEG).toHaveBeenCalledWith(80);
      expect(views[0].visible).toBe(false);
      expect(views[0].muted).toBe(false);

      host.unfreeze();
      expect(views[0].visible).toBe(true);
    });

    it("skips the resize when the view has no size", async () => {
      host.show({ ...BOUNDS, width: 0 });
      host.showActive(views[0] as never);
      const image = fakeImage();
      views[0].webContents.capturePage.mockResolvedValue(image);
      await host.freeze();
      expect(image.resize).not.toHaveBeenCalled();
    });

    it("does nothing when there is no page on screen", async () => {
      await expect(host.freeze()).resolves.toBeNull();

      showFirst();
      showable = false;
      await expect(host.freeze()).resolves.toBeNull();

      showable = true;
      host.hide();
      await expect(host.freeze()).resolves.toBeNull();
      expect(views[0].webContents.capturePage).not.toHaveBeenCalled();
    });

    it("does nothing while already frozen", async () => {
      showFirst();
      views[0].webContents.capturePage.mockResolvedValue(fakeImage());
      await host.freeze();
      await expect(host.freeze()).resolves.toBeNull();
      expect(views[0].webContents.capturePage).toHaveBeenCalledTimes(1);
    });

    it("still hides the page when the capture fails", async () => {
      showFirst();
      views[0].webContents.capturePage.mockRejectedValue(new Error("occluded"));
      await expect(host.freeze()).resolves.toBeNull();
      expect(views[0].visible).toBe(false);
    });

    it("hides the page but returns nothing for an empty capture", async () => {
      showFirst();
      views[0].webContents.capturePage.mockResolvedValue(fakeImage({ empty: true }));
      await expect(host.freeze()).resolves.toBeNull();
      expect(views[0].visible).toBe(false);
    });

    it("drops a capture that finishes after the menu closed", async () => {
      showFirst();
      let resolve!: (image: unknown) => void;
      views[0].webContents.capturePage.mockReturnValue(new Promise((r) => { resolve = r; }));
      const frozen = host.freeze();
      host.unfreeze();
      resolve(fakeImage());
      await expect(frozen).resolves.toBeNull();
      expect(views[0].visible).toBe(true);
    });

    it("drops a failed capture that finishes after the panel was shown again", async () => {
      showFirst();
      let reject!: (err: Error) => void;
      views[0].webContents.capturePage.mockReturnValue(new Promise((_r, j) => { reject = j; }));
      const frozen = host.freeze();
      showFirst();
      reject(new Error("occluded"));
      await expect(frozen).resolves.toBeNull();
      expect(views[0].visible).toBe(true);
    });

    it("is cleared by showing the panel again", async () => {
      showFirst();
      views[0].webContents.capturePage.mockResolvedValue(fakeImage());
      await host.freeze();
      showFirst();
      expect(views[0].visible).toBe(true);
    });
  });
});
