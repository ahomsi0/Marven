import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import type { AgentActivity } from "@/lib/inAppBrowser";
import { agentLine } from "./agentLine";

const html = (node: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, node));
const line = (activity: AgentActivity, waiting = false) => html(agentLine(i18n.t, activity, waiting));
const idle: AgentActivity = { tabId: "t1", state: "acting", action: null };

describe("agentLine", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("says it's waiting for the user's approval instead of thinking", async () => {
    expect(line(idle)).toBe("Marven is browsing — thinking");
    expect(line(idle, true)).toBe("Waiting for your approval");
    expect(line({ ...idle, action: { kind: "read", target: "shop.test" } }, true)).toBe("Marven is browsing — reading <bdi>shop.test</bdi>");
    expect(line({ tabId: "t1", state: "paused", action: null, reason: "user" }, true)).toBe("Paused — you&#x27;re in control");
    await i18n.changeLanguage("ar");
    expect(line(idle, true)).toBe("بانتظار موافقتك");
  });

  it("names going back in words, and a background pause", () => {
    expect(line({ ...idle, action: { kind: "history", target: "back" } })).toBe("Marven is browsing — going back");
    expect(line({ tabId: "t1", state: "paused", action: null, reason: "background" })).toBe("Paused while Marven is in the background");
  });
});
