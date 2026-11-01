import { describe, it, expect, afterEach } from "vitest";
import i18n, { APP_LANGUAGES, languageDir } from "./index";
import en from "./en";
import ar from "./ar";

function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : keys(v as Record<string, unknown>, `${prefix}${k}.`),
  );
}

describe("translations", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("Arabic has every English key, with a non-empty value", () => {
    const arKeys = new Set(keys(ar as Record<string, unknown>));
    for (const key of keys(en)) {
      expect(arKeys.has(key), key).toBe(true);
    }
    for (const key of arKeys) {
      const value = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], ar);
      expect((value as string).trim(), key).not.toBe("");
    }
  });

  it("keeps interpolation placeholders intact in Arabic", () => {
    const enMap = new Map(keys(en).map((k) => [k, k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], en) as string]));
    for (const [key, value] of enMap) {
      const arValue = key.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], ar) as string;
      for (const placeholder of value.match(/{{\w+}}|<\w+>/g) ?? []) {
        // Arabic plural forms like "منذ يوم" legitimately drop {{count}}.
        if (placeholder === "{{count}}" && /_(one|two)$/.test(key)) continue;
        expect(arValue, key).toContain(placeholder);
      }
    }
  });

  it("uses Arabic plural forms for relative dates", async () => {
    await i18n.changeLanguage("ar");
    expect(i18n.t("sidebar.daysAgo", { count: 2 })).toBe("منذ يومين");
    expect(i18n.t("sidebar.daysAgo", { count: 4 })).toBe("منذ 4 أيام");
    expect(i18n.t("sidebar.weeksAgo", { count: 1 })).toBe("منذ أسبوع");
    await i18n.changeLanguage("en");
    expect(i18n.t("sidebar.daysAgo", { count: 4 })).toBe("4 days ago");
  });

  it("marks Arabic as right-to-left", () => {
    expect(languageDir("ar")).toBe("rtl");
    expect(languageDir("en")).toBe("ltr");
    expect(APP_LANGUAGES.map((l) => l.code)).toEqual(["en", "ar"]);
  });
});
