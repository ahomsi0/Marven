import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { sanitizeThreadMessages, isReservedHotkey, MAX_MESSAGE_CHARS, MAX_MESSAGES } = require("./companionGuards");

describe("sanitizeThreadMessages", () => {
  it("returns null for non-arrays", () => {
    expect(sanitizeThreadMessages("x")).toBeNull();
    expect(sanitizeThreadMessages(null)).toBeNull();
  });
  it("keeps only user/assistant messages with string content", () => {
    const out = sanitizeThreadMessages([
      { role: "user", content: "hi", extra: 1 },
      { role: "system", content: "no" },
      { role: "assistant", content: 5 },
      null,
      { role: "assistant", content: "yo" },
    ]);
    expect(out).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "yo" },
    ]);
  });
  it("truncates content and keeps the last 20", () => {
    const msgs = Array.from({ length: 25 }, (_, i) => ({ role: "user", content: `m${i}` }));
    const out = sanitizeThreadMessages(msgs)!;
    expect(out).toHaveLength(MAX_MESSAGES);
    expect(out[0].content).toBe("m5");
    const long = sanitizeThreadMessages([{ role: "user", content: "a".repeat(MAX_MESSAGE_CHARS + 10) }])!;
    expect(long[0].content).toHaveLength(MAX_MESSAGE_CHARS);
  });
  it("returns null when nothing remains", () => {
    expect(sanitizeThreadMessages([{ role: "tool", content: "x" }])).toBeNull();
    expect(sanitizeThreadMessages([])).toBeNull();
  });
});

describe("isReservedHotkey", () => {
  it.each(["CommandOrControl+Shift+M", "cmdorctrl+shift+m", "Command+Shift+M", " CommandOrControl+Shift+M "])(
    "refuses %s", (a) => expect(isReservedHotkey(a)).toBe(true));
  it.each(["CommandOrControl+Shift+K", "Alt+Space", ""])("allows %s", (a) => expect(isReservedHotkey(a)).toBe(false));
});
