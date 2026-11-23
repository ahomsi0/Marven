import { describe, it, expect } from "vitest";
import {
  COMPANION_PERSONA,
  PERSONAS,
  HISTORY_KEY,
  appendHistory,
  buildCompanionPrompt,
  loadHistory,
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

describe("buildCompanionPrompt", () => {
  it("adds the persona after the base prompt", () => {
    expect(buildCompanionPrompt("BASE", "")).toBe(`BASE\n\n${COMPANION_PERSONA}`);
  });
  it("keeps the playful persona as COMPANION_PERSONA and the default", () => {
    expect(COMPANION_PERSONA).toBe(PERSONAS.playful);
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
    expect(prompt).toContain(COMPANION_PERSONA);
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
