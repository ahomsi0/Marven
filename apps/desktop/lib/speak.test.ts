import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A minimal Audio stand-in that behaves like Chromium's: clearing `src` on an
// element fires its `error` event.
class FakeAudio {
  static last: FakeAudio | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src: string;
  constructor(src: string) {
    this._src = src;
    FakeAudio.last = this;
  }
  get src() {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    if (value === "") queueMicrotask(() => this.onerror?.());
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("speak", () => {
  const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [{ name: "Daniel", lang: "en-GB" }], speaking: false };

  beforeEach(() => {
    vi.resetModules();
    synth.speak.mockClear();
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["mp3"]), { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("speaks a reply once: finishing the audio doesn't replay it with the fallback voice", async () => {
    const { speak } = await import("./speak");
    const onEnd = vi.fn();
    await speak("Hello there", onEnd);
    FakeAudio.last?.onended?.();
    await flush();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("still falls back to the system voice when the audio itself fails", async () => {
    const { speak } = await import("./speak");
    await speak("Hello there");
    FakeAudio.last?.onerror?.();
    await flush();
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });
});
