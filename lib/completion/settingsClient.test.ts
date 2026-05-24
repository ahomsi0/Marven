import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readInlineCompletionSettings,
  DEFAULT_INLINE_COMPLETION_SETTINGS,
} from "./settingsClient";

const realWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  if (realWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = realWindow;
  }
});

function setWindow(value: unknown) {
  (globalThis as { window?: unknown }).window = value;
}

describe("readInlineCompletionSettings", () => {
  it("returns defaults when window is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    expect(await readInlineCompletionSettings()).toEqual(
      DEFAULT_INLINE_COMPLETION_SETTINGS,
    );
  });

  it("returns defaults when marvenElectron missing", async () => {
    setWindow({});
    expect(await readInlineCompletionSettings()).toEqual(
      DEFAULT_INLINE_COMPLETION_SETTINGS,
    );
  });

  it("returns defaults when getSettings returns null", async () => {
    setWindow({ marvenElectron: { getSettings: async () => null } });
    expect(await readInlineCompletionSettings()).toEqual(
      DEFAULT_INLINE_COMPLETION_SETTINGS,
    );
  });

  it("fills missing keys with defaults (partial settings)", async () => {
    setWindow({
      marvenElectron: {
        getSettings: async () => ({ inlineCompletionsEnabled: true }),
      },
    });
    const s = await readInlineCompletionSettings();
    expect(s.enabled).toBe(true);
    expect(s.provider).toBe(DEFAULT_INLINE_COMPLETION_SETTINGS.provider);
    expect(s.model).toBe("");
    expect(s.debounceMs).toBe(350);
  });

  it("returns full settings when all keys present", async () => {
    setWindow({
      marvenElectron: {
        getSettings: async () => ({
          inlineCompletionsEnabled: true,
          inlineCompletionProvider: "openai",
          inlineCompletionModel: "gpt-4o-mini",
          inlineCompletionDebounceMs: 500,
        }),
      },
    });
    const s = await readInlineCompletionSettings();
    expect(s).toEqual({
      enabled: true,
      provider: "openai",
      model: "gpt-4o-mini",
      debounceMs: 500,
    });
  });

  it("clamps debounceMs to [100, 1500]", async () => {
    setWindow({
      marvenElectron: {
        getSettings: async () => ({ inlineCompletionDebounceMs: 50 }),
      },
    });
    expect((await readInlineCompletionSettings()).debounceMs).toBe(100);
    setWindow({
      marvenElectron: {
        getSettings: async () => ({ inlineCompletionDebounceMs: 5000 }),
      },
    });
    expect((await readInlineCompletionSettings()).debounceMs).toBe(1500);
  });

  it("rejects invalid provider, falls back to default", async () => {
    setWindow({
      marvenElectron: {
        getSettings: async () => ({ inlineCompletionProvider: "bogus" }),
      },
    });
    expect((await readInlineCompletionSettings()).provider).toBe(
      DEFAULT_INLINE_COMPLETION_SETTINGS.provider,
    );
  });
});
