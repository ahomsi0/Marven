import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./chatPrompt";

const empty = { global: [], project: [], conversation: [], legacy: [] };
const now = new Date("2026-11-23T10:30:00");

describe("buildSystemPrompt", () => {
  it("introduces Marven and the current date", () => {
    const prompt = buildSystemPrompt(null, empty, now);
    expect(prompt).toContain("You are Marven");
    expect(prompt).toContain("Current date and time:");
    expect(prompt).not.toContain("The user's name is");
  });
  it("adds the user's name", () => {
    expect(buildSystemPrompt("Ahmad", empty, now)).toContain("The user's name is Ahmad.");
  });
  it("includes memories", () => {
    const prompt = buildSystemPrompt(null, { ...empty, global: ["Likes mint tea"] }, now);
    expect(prompt).toContain("Likes mint tea");
  });
});
