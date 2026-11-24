import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);
const { sanitizeThreadMessages, sanitizeOpenMode, sanitizeOpenOptions, isReservedHotkey, projectFolderInside, sanitizeSettingsPage, isLoopbackHttpUrl, MAX_MESSAGE_CHARS, MAX_MESSAGES } = require("./companionGuards");

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

describe("sanitizeOpenOptions", () => {
  const home = "/Users/me";
  const dir = { isDirectory: () => true, isSymbolicLink: () => false };
  const deps = { home, realpath: (p: string) => p, lstat: () => dir };
  const root = "/Users/me/Marven Projects/cafe-menu";

  it("passes nothing on when there are no options", () => {
    expect(sanitizeOpenOptions(undefined, "agent", "~/Marven Projects", deps)).toEqual({});
    expect(sanitizeOpenOptions(null, "chat", "~/Marven Projects", deps)).toEqual({});
    expect(sanitizeOpenOptions("x", "agent", "~/Marven Projects", deps)).toEqual({});
    expect(sanitizeOpenOptions({}, "agent", "~/Marven Projects", deps)).toEqual({});
  });

  it("keeps a project folder and, for the Agent, autostart", () => {
    expect(sanitizeOpenOptions({ workspaceRoot: root }, "agent", "~/Marven Projects", deps)).toEqual({ workspaceRoot: root });
    expect(sanitizeOpenOptions({ workspaceRoot: root, autostart: true }, "agent", "~/Marven Projects", deps)).toEqual({ workspaceRoot: root, autostart: true });
    expect(sanitizeOpenOptions({ workspaceRoot: root, autostart: false }, "agent", "~/Marven Projects", deps)).toEqual({ workspaceRoot: root });
  });

  it("only a real boolean true starts anything", () => {
    for (const autostart of ["true", 1, "yes", {}, [true]]) {
      expect(sanitizeOpenOptions({ workspaceRoot: root, autostart }, "agent", "~/Marven Projects", deps)).toEqual({ workspaceRoot: root });
    }
  });

  it("drops a folder outside the projects folder but still opens the thread", () => {
    expect(sanitizeOpenOptions({ workspaceRoot: "/etc" }, "agent", "~/Marven Projects", deps)).toEqual({});
    expect(sanitizeOpenOptions({ workspaceRoot: 42 }, "agent", "~/Marven Projects", deps)).toEqual({});
  });

  it("refuses autostart without a valid project folder or outside the Agent", () => {
    expect(sanitizeOpenOptions({ autostart: true }, "agent", "~/Marven Projects", deps)).toBeNull();
    expect(sanitizeOpenOptions({ workspaceRoot: "/etc", autostart: true }, "agent", "~/Marven Projects", deps)).toBeNull();
    expect(sanitizeOpenOptions({ workspaceRoot: "/Users/me/Elsewhere/x", autostart: true }, "agent", "~/Marven Projects", deps)).toBeNull();
    expect(sanitizeOpenOptions({ workspaceRoot: root, autostart: true }, "chat", "~/Marven Projects", deps)).toBeNull();
  });
});

describe("projectFolderInside", () => {
  const home = "/Users/me";
  const identity = (p: string) => p;
  const dir = { isDirectory: () => true, isSymbolicLink: () => false };
  const file = { isDirectory: () => false, isSymbolicLink: () => false };
  const link = { isDirectory: () => false, isSymbolicLink: () => true };
  const deps = { home, realpath: identity, lstat: () => dir };

  it("returns the real path of a project folder directly inside the projects dir", () => {
    expect(projectFolderInside("/Users/me/Marven Projects/cafe-menu", "~/Marven Projects", deps)).toBe("/Users/me/Marven Projects/cafe-menu");
    expect(projectFolderInside("/Users/me/Marven Projects/cafe-menu/", "/Users/me/Marven Projects", deps)).toBe("/Users/me/Marven Projects/cafe-menu");
  });

  it("refuses files and anything deeper than a direct child", () => {
    expect(projectFolderInside("/Users/me/Marven Projects/cafe-menu/index.html", "/Users/me/Marven Projects", deps)).toBeNull();
    expect(projectFolderInside("/Users/me/Marven Projects/cafe-menu/src", "/Users/me/Marven Projects", deps)).toBeNull();
    expect(projectFolderInside("/Users/me/Marven Projects/notes.txt", "~/Marven Projects", { ...deps, lstat: () => file })).toBeNull();
  });

  it("refuses a symlink, even one pointing at a folder inside", () => {
    expect(projectFolderInside("/Users/me/Marven Projects/shortcut", "~/Marven Projects", { ...deps, lstat: () => link })).toBeNull();
  });

  it("refuses bundle-like names that macOS would launch", () => {
    for (const name of ["Evil.app", "x.bundle", "run.command", "a.tool", "b.workflow", "c.terminal", "d.pkg", "e.mpkg", "f.webloc", "G.APP"]) {
      expect(projectFolderInside(`/Users/me/Marven Projects/${name}`, "~/Marven Projects", deps), name).toBeNull();
    }
    expect(projectFolderInside("/Users/me/Marven Projects/my-app", "~/Marven Projects", deps)).toBe("/Users/me/Marven Projects/my-app");
  });

  it("falls back to the default projects dir when the setting is empty", () => {
    expect(projectFolderInside("/Users/me/Marven Projects/x", "", deps)).toBe("/Users/me/Marven Projects/x");
    expect(projectFolderInside("/Users/me/Marven Projects/x", undefined, deps)).toBe("/Users/me/Marven Projects/x");
  });

  it("rejects the projects dir itself, siblings, escapes and non-strings", () => {
    expect(projectFolderInside("/Users/me/Marven Projects", "~/Marven Projects", deps)).toBeNull();
    expect(projectFolderInside("/Users/me/Marven Projects-2/x", "~/Marven Projects", deps)).toBeNull();
    expect(projectFolderInside("/Users/me/Marven Projects/../.ssh", "~/Marven Projects", deps)).toBeNull();
    expect(projectFolderInside("/etc", "~/Marven Projects", deps)).toBeNull();
    expect(projectFolderInside("Marven Projects/x", "~/Marven Projects", deps)).toBeNull();
    expect(projectFolderInside(42, "~/Marven Projects", deps)).toBeNull();
    expect(projectFolderInside("/Users/me/Marven Projects/a\u0000b", "~/Marven Projects", deps)).toBeNull();
  });

  it("returns null when the path doesn't exist", () => {
    const missing = () => {
      throw new Error("ENOENT");
    };
    expect(projectFolderInside("/Users/me/Marven Projects/x", "~/Marven Projects", { home, realpath: missing, lstat: () => dir })).toBeNull();
    expect(projectFolderInside("/Users/me/Marven Projects/x", "~/Marven Projects", { home, realpath: identity, lstat: missing })).toBeNull();
  });

  it("on a real disk: a folder passes; a file, a nested folder and a symlink out are refused", () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "minime-guard-")));
    try {
      const projects = path.join(tmp, "projects");
      const outside = path.join(tmp, "outside");
      fs.mkdirSync(path.join(projects, "real", "src"), { recursive: true });
      fs.writeFileSync(path.join(projects, "real", "index.html"), "x");
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(projects, "link"));
      const real = { home: tmp, realpath: fs.realpathSync, lstat: fs.lstatSync };
      expect(projectFolderInside(path.join(projects, "real"), projects, real)).toBe(path.join(projects, "real"));
      expect(projectFolderInside(path.join(projects, "real", "index.html"), projects, real)).toBeNull();
      expect(projectFolderInside(path.join(projects, "real", "src"), projects, real)).toBeNull();
      expect(projectFolderInside(path.join(projects, "link"), projects, real)).toBeNull();
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

describe("sanitizeSettingsPage", () => {
  it("passes the pages Mini Me may open and falls back to keys-ai", () => {
    expect(sanitizeSettingsPage("general")).toBe("general");
    expect(sanitizeSettingsPage("mini-me")).toBe("mini-me");
    expect(sanitizeSettingsPage("keys-ai")).toBe("keys-ai");
    expect(sanitizeSettingsPage(undefined)).toBe("keys-ai");
    expect(sanitizeSettingsPage("about")).toBe("keys-ai");
    expect(sanitizeSettingsPage({ page: "general" })).toBe("keys-ai");
  });
});
