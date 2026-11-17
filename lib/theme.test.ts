// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getStoredTheme, setStoredTheme, THEME_CHANGE_EVENT, type Theme } from "./theme";

describe("setStoredTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("saves the theme, updates data-theme and announces the change once", () => {
    const listener = vi.fn();
    window.addEventListener(THEME_CHANGE_EVENT, listener);
    try {
      setStoredTheme("midnight");
    } finally {
      window.removeEventListener(THEME_CHANGE_EVENT, listener);
    }
    expect(localStorage.getItem("marven-theme")).toBe("midnight");
    expect(document.documentElement.dataset.theme).toBe("midnight");
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent<Theme>).detail).toBe("midnight");
  });
});

describe("getStoredTheme", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to dark when missing or unknown", () => {
    expect(getStoredTheme()).toBe("dark");
    localStorage.setItem("marven-theme", "neon");
    expect(getStoredTheme()).toBe("dark");
  });

  it.each(["light", "midnight", "aurora"] as const)("returns stored %s", (t) => {
    localStorage.setItem("marven-theme", t);
    expect(getStoredTheme()).toBe(t);
  });
});
