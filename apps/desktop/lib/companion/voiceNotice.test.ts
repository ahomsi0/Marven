import { describe, expect, it } from "vitest";
import { voiceNotice } from "./voiceNotice";

// A fake translator that echoes the key and the error, so the logic is tested without i18n.
const t = (key: string, opts?: Record<string, unknown>) => (opts?.error ? `${key}(${opts.error})` : key);

describe("voiceNotice", () => {
  it("shows only the problem for ordinary errors", () => {
    expect(voiceNotice("no speech service", t)).toBe("companion.voiceUnavailable(no speech service)");
  });
  it("adds the microphone hint for permission problems", () => {
    expect(voiceNotice("mic-denied NotAllowedError", t)).toMatch(/^companion\.voiceUnavailable\(.*\)\. companion\.voiceMicHint$/);
    expect(voiceNotice("Permission denied", t)).toMatch(/companion\.voiceMicHint/);
  });
});
