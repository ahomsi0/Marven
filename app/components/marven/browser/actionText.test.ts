import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { actionKey } from "./actionText";

describe("actionKey", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("names going back, forward and reloading in words, not the tool's enum", async () => {
    expect(i18n.t(actionKey("history", "back"))).toBe("going back");
    expect(i18n.t(actionKey("history", "forward"))).toBe("going forward");
    expect(i18n.t(actionKey("history", "reload"))).toBe("reloading the page");
    await i18n.changeLanguage("ar");
    expect(i18n.t(actionKey("history", "reload"))).toBe("يعيد تحميل الصفحة");
    expect(i18n.t(actionKey("history", "back"))).not.toMatch(/back/);
  });

  it("uses the action's own string for everything else", () => {
    expect(actionKey("click", "Buy")).toBe("browser.agent.actions.click");
    expect(actionKey("history", "home")).toBe("browser.agent.actions.history");
    expect(i18n.t(actionKey("open", "x"), { target: "example.com" })).toBe("opening example.com");
  });
});
