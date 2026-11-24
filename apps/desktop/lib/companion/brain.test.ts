import { describe, it, expect } from "vitest";
import {
  PERSONAS,
  HISTORY_KEY,
  appendHistory,
  buildCompanionPrompt,
  loadHistory,
  projectSlug,
  routeInput,
  saveHistory,
  type CompanionMessage,
} from "./brain";

describe("routeInput", () => {
  const on = { allowCommands: true };
  it("routes timers", () => {
    expect(routeInput("set a timer for 2 minutes", on)).toEqual({ kind: "timer", ms: 120_000, label: "2 minutes" });
  });
  it("routes clipboard actions", () => {
    expect(routeInput("summarize my clipboard", on)).toEqual({ kind: "clipboard", action: "summarize" });
  });
  it("routes system commands", () => {
    expect(routeInput("open spotify", on)).toEqual({ kind: "command" });
    expect(routeInput("volume up", on)).toEqual({ kind: "command" });
  });
  it("sends commands to chat when commands are off", () => {
    expect(routeInput("volume up", { allowCommands: false })).toEqual({ kind: "chat" });
  });
  it("hands shell, file and browsing jobs to the Agent", () => {
    for (const text of [
      "run npm install",
      "execute the script",
      "create a new file called notes.txt",
      "delete the folder old-builds",
      "browse to amazon.com and buy socks",
    ]) {
      expect(routeInput(text, on), text).toEqual({ kind: "agent" });
    }
  });
  it("hands more phrasings of shell, file and browser jobs to the Agent", () => {
    for (const text of [
      "delete my Downloads folder",
      "delete all my files",
      "remove the files in Downloads",
      "delete everything in ~/Desktop",
      "execute rm -rf ~",
      "rm -rf ~/Documents",
      "run ls",
      "run brew upgrade",
      "can you run npm install",
      "pip install requests",
      "chmod +x x.sh",
      "go to amazon.com and buy socks",
      "can you create a file for me?",
    ]) {
      expect(routeInput(text, on), text).toEqual({ kind: "agent" });
    }
  });
  it("sends how-to questions to chat", () => {
    for (const text of [
      "how do I create a new file in vim?",
      "how do i delete a folder on mac",
      "what's the best way to rename a file in git?",
      "how do I move a file in python",
    ]) {
      expect(routeInput(text, on), text).toEqual({ kind: "chat" });
    }
  });
  it("sends everything else to chat", () => {
    for (const text of ["how do I run a marathon?", "tell me a joke", "what are files made of?"]) {
      expect(routeInput(text, on), text).toEqual({ kind: "chat" });
    }
  });
});

describe("build routing", () => {
  const on = { allowCommands: true };
  it("recognises build requests and names the project", () => {
    const cases: [string, string][] = [
      ["create a cafe menu", "cafe menu"],
      ["build me a todo app", "todo app"],
      ["make a landing page for my bakery", "landing page bakery"],
      ["can you create a portfolio website", "portfolio website"],
      ["Please build us a simple blog.", "simple blog"],
      ["could you make me a to-do list", "to-do list"],
      ["scaffold a React dashboard", "react dashboard"],
      ["set up a new API", "api"],
      ["generate a quiz about space", "quiz space"],
      ["create a game called Snake", "snake"],
    ];
    for (const [text, name] of cases) {
      expect(routeInput(text, on), text).toEqual({ kind: "build", name });
    }
  });
  it("keeps non-build creative and how-to requests in chat", () => {
    for (const text of [
      "make a joke",
      "create a poem about cats",
      "how do I build a website?",
      "write me an email",
      "what is a todo app",
      "make me a sandwich",
    ]) {
      expect(routeInput(text, on), text).toEqual({ kind: "chat" });
    }
  });
  it("lets agent-only file jobs win over build", () => {
    expect(routeInput("create a new file called menu.html", on)).toEqual({ kind: "agent" });
    expect(routeInput("create a project folder", on)).toEqual({ kind: "agent" });
  });
  it("keeps timers and commands ahead of build, and can be turned off", () => {
    expect(routeInput("set a timer for 2 minutes", on)).toEqual({ kind: "timer", ms: 120_000, label: "2 minutes" });
    expect(routeInput("open spotify", on)).toEqual({ kind: "command" });
    expect(routeInput("create a cafe menu", { allowCommands: true, allowBuild: false })).toEqual({ kind: "chat" });
  });
});

describe("build routing: desire phrasing and generic names", () => {
  const on = { allowCommands: true };
  it("accepts desire phrasing with a buildable noun", () => {
    const cases: [string, string][] = [
      ["I want a website for my cafe", "website cafe"],
      ["I need a todo app", "todo app"],
      ["I'd like a landing page", "landing page"],
      ["I would like an online store", "online store"],
      ["I'm looking for a portfolio website", "portfolio website"],
      ["give me a quiz about space", "quiz space"],
      ["get me a calculator", "calculator"],
      ["please give me a dashboard", "dashboard"],
    ];
    for (const [text, name] of cases) expect(routeInput(text, on), text).toEqual({ kind: "build", name });
  });
  it("keeps non-buildable desires in chat", () => {
    for (const text of ["I want a coffee", "I need a break", "give me a joke", "get me some water", "I want to know about apps", "I need help with my app"]) {
      expect(routeInput(text, on), text).toEqual({ kind: "chat" });
    }
  });
  it("adds meaningful words when only a generic noun is left", () => {
    expect(routeInput("make an app that tracks habits", on)).toEqual({ kind: "build", name: "app tracks habits" });
    expect(routeInput("build a website with react", on)).toEqual({ kind: "build", name: "website react" });
    expect(routeInput("create a game that lets me practise typing speed daily", on)).toEqual({
      kind: "build",
      name: "game practise typing speed",
    });
    expect(routeInput("make a tool", on)).toEqual({ kind: "build", name: "tool" });
  });
  it("leaves specific names alone", () => {
    expect(routeInput("create a cafe menu that is printable", on)).toEqual({ kind: "build", name: "cafe menu" });
  });
});

describe("projectSlug (re-export)", () => {
  it("is available from brain", () => {
    expect(projectSlug("Cafe Menu")).toBe("cafe-menu");
  });
});

describe("buildCompanionPrompt", () => {
  it("adds the persona after the base prompt", () => {
    expect(buildCompanionPrompt("BASE", "")).toBe(`BASE\n\n${PERSONAS.playful}`);
  });
  it("uses the playful persona when asked for it explicitly", () => {
    expect(buildCompanionPrompt("BASE", "", "playful")).toBe(`BASE\n\n${PERSONAS.playful}`);
  });
  it("uses the neutral persona", () => {
    const prompt = buildCompanionPrompt("BASE", "", "neutral");
    expect(prompt).toBe(`BASE\n\n${PERSONAS.neutral}`);
    expect(PERSONAS.neutral).toContain("1–3 short, plain sentences");
    expect(prompt).not.toContain(PERSONAS.playful);
  });
  it("uses the detailed persona", () => {
    const prompt = buildCompanionPrompt("BASE", "", "detailed");
    expect(prompt).toBe(`BASE\n\n${PERSONAS.detailed}`);
    expect(PERSONAS.detailed).toContain("complete, well-organised answers");
  });
  it("applies custom instructions with any personality", () => {
    expect(buildCompanionPrompt("BASE", "X", "neutral")).toContain(PERSONAS.neutral);
  });
  it("puts custom instructions first and last", () => {
    const prompt = buildCompanionPrompt("BASE", " Speak Arabic ");
    expect(prompt.startsWith("### PRIORITY INSTRUCTIONS (always follow these):\nSpeak Arabic")).toBe(true);
    expect(prompt.endsWith("REMINDER: Speak Arabic")).toBe(true);
    expect(prompt).toContain(PERSONAS.playful);
  });
});

describe("history", () => {
  const msg = (i: number): CompanionMessage => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` });

  it("keeps the last 20 messages", () => {
    const history = appendHistory(Array.from({ length: 19 }, (_, i) => msg(i)), msg(19), msg(20));
    expect(history).toHaveLength(20);
    expect(history[0].content).toBe("m1");
    expect(history[19].content).toBe("m20");
  });

  it("round-trips through storage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveHistory(storage, [msg(0), msg(1)]);
    expect(loadHistory(storage)).toEqual([msg(0), msg(1)]);
  });

  it("ignores corrupt or malformed storage", () => {
    expect(loadHistory({ getItem: () => "not json" })).toEqual([]);
    expect(loadHistory({ getItem: () => JSON.stringify({ a: 1 }) })).toEqual([]);
    const mixed = JSON.stringify([{ role: "user", content: "ok" }, { role: "system", content: "x" }, { role: "user" }]);
    expect(loadHistory({ getItem: (k: string) => (k === HISTORY_KEY ? mixed : null) })).toEqual([{ role: "user", content: "ok" }]);
  });
});
