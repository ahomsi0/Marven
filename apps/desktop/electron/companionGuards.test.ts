import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);
const { sanitizeThreadMessages, sanitizeOpenMode, isReservedHotkey, projectPathInside, isLoopbackHttpUrl, MAX_MESSAGE_CHARS, MAX_MESSAGES } = require("./companionGuards");

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
  it.each(["CommandOrControl+Shift+M", "cmdorctrl+shift+m", "Command+Shift+M", " CommandOrControl+Shift+M ",
    "Cmd+Shift+M", "Shift+CmdOrCtrl+M", "command+shift+m", "Shift + Cmd + M"])(
    "refuses %s on darwin", (a) => expect(isReservedHotkey(a, "darwin")).toBe(true));
  it.each(["Ctrl+Shift+M", "Control+Shift+M", "shift+ctrl+m"])("refuses %s on win32/linux", (a) => {
    expect(isReservedHotkey(a, "win32")).toBe(true);
    expect(isReservedHotkey(a, "linux")).toBe(true);
  });
  it("does not treat Ctrl+Shift+M as reserved on darwin", () => {
    expect(isReservedHotkey("Ctrl+Shift+M", "darwin")).toBe(false);
  });
  it.each(["CommandOrControl+Shift+K", "CommandOrControl+Shift+Space", "Alt+Space", "", "CommandOrControl+Alt+Shift+M"])(
    "allows %s", (a) => expect(isReservedHotkey(a, "darwin")).toBe(false));
  it("defaults to process.platform", () => {
    expect(isReservedHotkey("CommandOrControl+Shift+M")).toBe(true);
  });
});

describe("sanitizeOpenMode", () => {
  it("accepts agent and falls back to chat for anything else", () => {
    expect(sanitizeOpenMode("agent")).toBe("agent");
    expect(sanitizeOpenMode("chat")).toBe("chat");
    expect(sanitizeOpenMode(undefined)).toBe("chat");
    expect(sanitizeOpenMode("shell")).toBe("chat");
    expect(sanitizeOpenMode({})).toBe("chat");
  });
});

describe("projectPathInside", () => {
  const home = "/Users/me";
  const identity = (p: string) => p;
  const deps = { home, realpath: identity };

  it("returns the real path of a folder inside the projects dir", () => {
    expect(projectPathInside("/Users/me/Marven Projects/cafe-menu", "~/Marven Projects", deps)).toBe("/Users/me/Marven Projects/cafe-menu");
    expect(projectPathInside("/Users/me/Marven Projects/cafe-menu/index.html", "/Users/me/Marven Projects", deps)).toBe(
      "/Users/me/Marven Projects/cafe-menu/index.html",
    );
  });

  it("falls back to the default projects dir when the setting is empty", () => {
    expect(projectPathInside("/Users/me/Marven Projects/x", "", deps)).toBe("/Users/me/Marven Projects/x");
    expect(projectPathInside("/Users/me/Marven Projects/x", undefined, deps)).toBe("/Users/me/Marven Projects/x");
  });

  it("rejects the projects dir itself, siblings, escapes and non-strings", () => {
    expect(projectPathInside("/Users/me/Marven Projects", "~/Marven Projects", deps)).toBeNull();
    expect(projectPathInside("/Users/me/Marven Projects-2/x", "~/Marven Projects", deps)).toBeNull();
    expect(projectPathInside("/Users/me/Marven Projects/../.ssh", "~/Marven Projects", deps)).toBeNull();
    expect(projectPathInside("/etc", "~/Marven Projects", deps)).toBeNull();
    expect(projectPathInside("Marven Projects/x", "~/Marven Projects", deps)).toBeNull();
    expect(projectPathInside(42, "~/Marven Projects", deps)).toBeNull();
    expect(projectPathInside("/Users/me/Marven Projects/a\u0000b", "~/Marven Projects", deps)).toBeNull();
  });

  it("returns null when the path doesn't exist", () => {
    const realpath = () => {
      throw new Error("ENOENT");
    };
    expect(projectPathInside("/Users/me/Marven Projects/x", "~/Marven Projects", { home, realpath })).toBeNull();
  });

  it("follows symlinks, so a link out of the projects dir is refused", () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "minime-guard-")));
    try {
      const projects = path.join(tmp, "projects");
      const outside = path.join(tmp, "outside");
      fs.mkdirSync(path.join(projects, "real"), { recursive: true });
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(projects, "link"));
      const real = { home: tmp, realpath: fs.realpathSync };
      expect(projectPathInside(path.join(projects, "real"), projects, real)).toBe(path.join(projects, "real"));
      expect(projectPathInside(path.join(projects, "link"), projects, real)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("isLoopbackHttpUrl", () => {
  it("accepts http(s) on this machine", () => {
    expect(isLoopbackHttpUrl("http://localhost:5173")).toBe(true);
    expect(isLoopbackHttpUrl("https://127.0.0.1:8443/app")).toBe(true);
    expect(isLoopbackHttpUrl("http://[::1]:3000/")).toBe(true);
    expect(isLoopbackHttpUrl("http://app.localhost:3000")).toBe(true);
  });
  it("rejects other hosts, schemes and junk", () => {
    expect(isLoopbackHttpUrl("https://example.com")).toBe(false);
    expect(isLoopbackHttpUrl("http://localhost.evil.com")).toBe(false);
    expect(isLoopbackHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isLoopbackHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isLoopbackHttpUrl("http://user:pw@localhost:3000")).toBe(false);
    expect(isLoopbackHttpUrl(42)).toBe(false);
    expect(isLoopbackHttpUrl("x".repeat(3000))).toBe(false);
  });
});
