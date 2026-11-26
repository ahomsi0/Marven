import { describe, it, expect } from "vitest";
import {
  BUILD_RULE,
  PERSONAS,
  looksLikeBuildMarkerPrefix,
  parseBuildMarker,
  resolveChatReply,
  HISTORY_KEY,
  appendHistory,
  buildCompanionPrompt,
  loadHistory,
  projectSlug,
  projectNameFor,
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
    expect(buildCompanionPrompt("BASE", "")).toBe(`BASE\n\n${PERSONAS.playful}\n\n${BUILD_RULE}`);
  });
  it("uses the playful persona when asked for it explicitly", () => {
    expect(buildCompanionPrompt("BASE", "", "playful")).toBe(`BASE\n\n${PERSONAS.playful}\n\n${BUILD_RULE}`);
  });
  it("uses the neutral persona", () => {
    const prompt = buildCompanionPrompt("BASE", "", "neutral");
    expect(prompt).toBe(`BASE\n\n${PERSONAS.neutral}\n\n${BUILD_RULE}`);
    expect(PERSONAS.neutral).toContain("1–3 short, plain sentences");
    expect(prompt).not.toContain(PERSONAS.playful);
  });
  it("uses the detailed persona", () => {
    const prompt = buildCompanionPrompt("BASE", "", "detailed");
    expect(prompt).toBe(`BASE\n\n${PERSONAS.detailed}\n\n${BUILD_RULE}`);
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

describe("build marker", () => {
  it("parses the marker in its variants", () => {
    expect(parseBuildMarker("[[BUILD: ahmad homsi site]]")).toEqual({ name: "ahmad homsi site" });
    expect(parseBuildMarker("[[build:  Cafe Menu  ]]")).toEqual({ name: "Cafe Menu" });
    expect(parseBuildMarker("   \n[[Build: snake game]]")).toEqual({ name: "snake game" });
    expect(parseBuildMarker("```\n[[BUILD: todo app]]\n```")).toEqual({ name: "todo app" });
    expect(parseBuildMarker("```text\n[[BUILD: todo app]]")).toEqual({ name: "todo app" });
    expect(parseBuildMarker('"[[BUILD: portfolio]]"')).toEqual({ name: "portfolio" });
    expect(parseBuildMarker("`[[BUILD: quiz]]`")).toEqual({ name: "quiz" });
  });
  it("ignores mid-text, empty and malformed markers", () => {
    expect(parseBuildMarker("Sure! [[BUILD: site]]")).toBeNull();
    expect(parseBuildMarker("[[BUILD: ]]")).toBeNull();
    expect(parseBuildMarker("[[BUILD:]]")).toBeNull();
    expect(parseBuildMarker("[[BUILD: site")).toBeNull();
    expect(parseBuildMarker("hello")).toBeNull();
  });
  it("detects a streaming prefix", () => {
    for (const p of ["", "[", "[[", "[[B", "[[build", "[[BUILD:", "[[BUILD: caf", "[[BUILD: cafe]", "[[BUILD: cafe]]", " ```\n[[BU"]) {
      expect(looksLikeBuildMarkerPrefix(p)).toBe(true);
    }
    for (const p of ["Hello", "[1] item", "[[X", "Sure [[BUILD", "[[BUILD: a\nb"]) {
      expect(looksLikeBuildMarkerPrefix(p)).toBe(false);
    }
  });
  it("puts the rule in every personality's prompt, and omits it when build is disabled", () => {
    for (const p of ["playful", "neutral", "detailed"] as const) {
      expect(buildCompanionPrompt("base", "", p)).toContain("[[BUILD:");
      expect(buildCompanionPrompt("base", "be brief", p)).toContain(BUILD_RULE);
      expect(buildCompanionPrompt("base", "", p, { allowBuild: false })).not.toContain("BUILD");
    }
  });
  it("resolves a finished reply", () => {
    expect(resolveChatReply("[[BUILD: site]]", true)).toEqual({ kind: "build", name: "site" });
    expect(resolveChatReply("[[BUILD: site]]", false)).toEqual({ kind: "text", text: "" });
    expect(resolveChatReply("Hi there", true)).toEqual({ kind: "text", text: "Hi there" });
  });
});

describe("edit routing (a project Mini Me built)", () => {
  const recent = { allowCommands: true, project: { recent: true } };
  const older = { allowCommands: true, project: { recent: false } };

  it("routes a change to the current project to edit, not to a new build", () => {
    expect(routeInput("change the background to red", recent)).toEqual({ kind: "edit" });
    expect(routeInput("please make the title bigger", recent)).toEqual({ kind: "edit" });
    expect(routeInput("can you add a contact section", recent)).toEqual({ kind: "edit" });
    expect(routeInput("remove the photo", older)).toEqual({ kind: "edit" });
    expect(routeInput("Change the website colours to blue.", older)).toEqual({ kind: "edit" });
  });
  it("reads 'it' as the project only right after working on it", () => {
    expect(routeInput("make it red", recent)).toEqual({ kind: "edit" });
    expect(routeInput("make it shorter", older)).toEqual({ kind: "chat" });
  });
  it("never edits without a project", () => {
    expect(routeInput("change the background to red", { allowCommands: true })).toEqual({ kind: "chat" });
  });
  it("keeps new builds, questions, timers and unrelated asks as they were", () => {
    expect(routeInput("make a portfolio website", recent)).toEqual({ kind: "build", name: "portfolio website" });
    expect(routeInput("how do I change the background?", recent)).toEqual({ kind: "chat" });
    expect(routeInput("set a timer for 2 minutes", recent).kind).toBe("timer");
    expect(routeInput("add 2 and 3", recent)).toEqual({ kind: "chat" });
    expect(routeInput("delete everything in Downloads", recent)).toEqual({ kind: "agent" });
  });
});

describe("edit marker", () => {
  it("resolves [[EDIT]] to an edit only when edits are on", () => {
    expect(resolveChatReply("[[EDIT]]", true, true)).toEqual({ kind: "edit" });
    expect(resolveChatReply("```\n[[edit]]\n```", true, true)).toEqual({ kind: "edit" });
    expect(resolveChatReply("[[EDIT]]", true, false)).toEqual({ kind: "text", text: "" });
    expect(resolveChatReply("[[BUILD: site]]", true, true)).toEqual({ kind: "build", name: "site" });
  });
  it("holds back a streamed edit marker", () => {
    for (const p of ["[", "[[", "[[E", "[[ed", "[[edit", "[[EDIT]", "[[EDIT]]"]) expect(looksLikeBuildMarkerPrefix(p), p).toBe(true);
    expect(looksLikeBuildMarkerPrefix("[[editor")).toBe(false);
  });
  it("tells the model about the current project", () => {
    const prompt = buildCompanionPrompt("BASE", "", "playful", { project: { name: 'ali "itani"\nsite' } });
    expect(prompt).toContain("[[EDIT]]");
    expect(prompt).toContain("ali itani site");
    expect(buildCompanionPrompt("BASE", "", "playful", { allowBuild: false, project: { name: "x" } })).not.toContain("[[EDIT]]");
  });
});

describe("corrections right after a run", () => {
  const after = { allowCommands: true, afterRun: true, project: { recent: true } };
  it("switches to a new project", () => {
    for (const t of ["no, make a new one", "start a new project", "make it a separate site", "a new one instead", "No. New project!"]) {
      expect(routeInput(t, after), t).toEqual({ kind: "new-instead" });
    }
  });
  it("answers in chat instead", () => {
    expect(routeInput("no, just tell me", after)).toEqual({ kind: "chat-instead" });
    expect(routeInput("don't build it", after)).toEqual({ kind: "chat-instead" });
  });
  it("stops", () => {
    expect(routeInput("stop", after)).toEqual({ kind: "stop" });
    expect(routeInput("cancel!", after)).toEqual({ kind: "stop" });
  });
  it("only right after a run", () => {
    const idle = { allowCommands: true };
    expect(routeInput("no, make a new one", idle).kind).not.toBe("new-instead");
    expect(routeInput("stop", idle).kind).not.toBe("stop");
  });
  it("a new request with details is a build, not a correction", () => {
    expect(routeInput("make another site for my cafe", after)).toEqual({ kind: "build", name: "site cafe" });
  });
});

describe("projectNameFor", () => {
  it("uses the build name, else the first words", () => {
    expect(projectNameFor("make a portfolio website for James Doe")).toBe("portfolio website james doe");
    expect(projectNameFor("red background, bigger title")).toBe("red background bigger title");
    expect(projectNameFor("   ")).toBe("project");
  });
});
