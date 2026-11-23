import { describe, expect, it } from "vitest";
import { voiceNotice } from "./voiceNotice";

describe("voiceNotice", () => {
  it("shows only the problem for ordinary errors", () => {
    expect(voiceNotice("no speech service")).toBe("Voice isn't available: no speech service");
  });
  it("adds the microphone hint for permission problems", () => {
    expect(voiceNotice("mic-denied NotAllowedError")).toMatch(/^Voice isn't available: .*Allow microphone access/);
    expect(voiceNotice("Permission denied")).toMatch(/Allow microphone access/);
  });
});
