import { describe, expect, it } from "vitest";
import { parseCommand } from "./commandParser";
import type { CustomShortcut } from "@/types";

const NONE = { type: null, payload: "" };

describe("parseCommand — ordinary chat never becomes a command", () => {
  it.each([
    "How do I get the current date in JavaScript?",
    "How do I open the terminal in VS Code?",
    "Can you run this code and tell me what it prints?",
    "Why won't my server start on port 3000 with google auth?",
    "what's the time complexity of quicksort?",
    "what's the time complexity of quicksort",
    "empty the trash",
    "Empty the trash.",
    "please open the PR description and summarise it",
    "run the tests and fix failures",
    "I want to launch a startup",
    "I was reading about how people open youtube in a browser tab and then forget about it for hours, any tips?",
    "I was reading about how people open youtube in a browser tab and then forget about it for hours",
    "can you open spotify",
    "could you open chrome please",
    "open youtube?",
    "run terminal",
    "run spotify",
    "open package.json",
    "open src/app.tsx",
    "open notes about the meeting",
    "tell me the time complexity of merge sort",
    "what is the date format in ISO 8601?",
    "search google for cats\nand dogs",
    "what time is it in Tokyo?",
    "open https://example.com?",
    "can you open https://example.com/search?q=x",
    "is https://example.com/search?q=x safe to open?",
  ])("%j → no command", (msg) => {
    expect(parseCommand(msg)).toEqual(NONE);
  });

  it("does not match a document body appended after the typed text", () => {
    const withDoc = "summarise this\n\n---\n[Document: notes.txt]\nopen youtube\n---";
    expect(parseCommand(withDoc)).toEqual(NONE);
  });
});

describe("parseCommand — built-in commands (whole-message phrasings)", () => {
  it.each([
    ["what time is it", "get-time"],
    ["What time is it?", "get-time"],
    ["what's the time", "get-time"],
    ["What’s the time?", "get-time"],
    ["what is the time", "get-time"],
    ["tell me the time", "get-time"],
    ["current time", "get-time"],
    ["time now", "get-time"],
    ["what's the date", "get-date"],
    ["What's the date?", "get-date"],
    ["what's today's date", "get-date"],
    ["what is the date", "get-date"],
    ["what day is it", "get-date"],
    ["what day is today", "get-date"],
    ["today's date", "get-date"],
    ["what's today", "get-date"],
    ["take a screenshot", "take-screenshot"],
    ["Take a screenshot.", "take-screenshot"],
    ["lock the screen", "lock-screen"],
    ["lock screen", "lock-screen"],
    ["open my downloads", "open-downloads"],
    ["open downloads", "open-downloads"],
    ["volume up", "volume-up"],
    ["turn it down", "volume-down"],
    ["mute", "volume-mute"],
    ["unmute the sound", "volume-unmute"],
    ["play", "media-play-pause"],
    ["pause", "media-play-pause"],
    ["next song", "media-next"],
    ["previous track", "media-previous"],
    ["what's playing", "media-what-playing"],
    ["What's playing?", "media-what-playing"],
    ["battery level", "get-battery"],
    ["how's my battery?", "get-battery"],
  ])("%j → %s", (msg, type) => {
    expect(parseCommand(msg)).toEqual({ type, payload: "" });
  });

  it("parses set volume with its level", () => {
    expect(parseCommand("set the volume to 40%")).toEqual({ type: "set-volume", payload: "40" });
  });

  it.each([
    ["search google for best pizza", "best pizza"],
    ["search for typescript generics", "typescript generics"],
    ["google search weather in paris", "weather in paris"],
    ["search llamas on google", "llamas"],
  ])("%j → google-search %j", (msg, payload) => {
    expect(parseCommand(msg)).toEqual({ type: "google-search", payload });
  });

  it.each([
    ["open youtube", "https://www.youtube.com"],
    ["Open YouTube.", "https://www.youtube.com"],
    ["go to github", "https://www.github.com"],
    ["visit reddit", "https://www.reddit.com"],
    ["navigate to gmail", "https://mail.google.com"],
    ["launch netflix", "https://www.netflix.com"],
    ["please open google", "https://www.google.com"],
    ["open github.com", "https://github.com"],
    ["open https://example.com/docs", "https://example.com/docs"],
    ["visit news.ycombinator.com", "https://news.ycombinator.com"],
    ["open https://example.com/search?q=x", "https://example.com/search?q=x"],
    ["go to http://localhost.test/a?b=1&c=2", "http://localhost.test/a?b=1&c=2"],
  ])("%j → open-website %s", (msg, payload) => {
    expect(parseCommand(msg)).toEqual({ type: "open-website", payload });
  });

  it.each([
    ["open chrome", "Google Chrome"],
    ["Open Chrome!", "Google Chrome"],
    ["open terminal", "Terminal"],
    ["open up safari", "Safari"],
    ["launch slack", "Slack"],
    ["start spotify", "Spotify"],
    ["open vs code", "Visual Studio Code"],
    ["hey marven, open finder", "Finder"],
    ["open spotify for me", "Spotify"],
    ["open system settings", "System Settings"],
  ])("%j → open-app %s", (msg, payload) => {
    expect(parseCommand(msg)).toEqual({ type: "open-app", payload });
  });
});

describe("parseCommand — custom shortcuts", () => {
  const shortcuts: CustomShortcut[] = [
    { trigger: "My Board", url: "https://trello.com/b/abc" },
    { trigger: "standup", url: "https://meet.example.com/standup" },
  ];

  it("matches the exact trigger, case- and punctuation-insensitively", () => {
    expect(parseCommand("my board", shortcuts)).toEqual({ type: "open-website", payload: "https://trello.com/b/abc" });
    expect(parseCommand("  Standup. ", shortcuts)).toEqual({
      type: "open-website",
      payload: "https://meet.example.com/standup",
    });
  });

  it("matches 'open <trigger>'", () => {
    expect(parseCommand("open my board", shortcuts)).toEqual({ type: "open-website", payload: "https://trello.com/b/abc" });
    expect(parseCommand("go to standup", shortcuts)).toEqual({
      type: "open-website",
      payload: "https://meet.example.com/standup",
    });
  });

  it("does not match a trigger mentioned inside a longer message", () => {
    expect(parseCommand("can we skip standup today", shortcuts)).toEqual(NONE);
    expect(parseCommand("please open my board and tell me what's due", shortcuts)).toEqual(NONE);
  });

  it("an exact trigger takes precedence over built-ins", () => {
    expect(parseCommand("Open YouTube", [{ trigger: "open youtube", url: "https://music.youtube.com" }])).toEqual({
      type: "open-website",
      payload: "https://music.youtube.com",
    });
  });
});
