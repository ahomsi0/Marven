import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "module";

// envSanitize.js is CommonJS (Electron main process), so load it with require.
const require = createRequire(import.meta.url);
const { terminalEnv, sanitizedEnv } = require("./envSanitize") as {
  terminalEnv: () => Record<string, string | undefined>;
  sanitizedEnv: (extra?: Record<string, string>) => Record<string, string | undefined>;
};

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe("terminalEnv", () => {
  it("advertises a 256-colour, true-colour terminal", () => {
    const env = terminalEnv();
    expect(env.TERM).toBe("xterm-256color");
    expect(env.COLORTERM).toBe("truecolor");
  });

  it("turns on coloured ls by default", () => {
    delete process.env.CLICOLOR;
    delete process.env.NO_COLOR;
    expect(terminalEnv().CLICOLOR).toBe("1");
  });

  it("keeps the user's own CLICOLOR choice", () => {
    process.env.CLICOLOR = "0";
    expect(terminalEnv().CLICOLOR).toBe("0");
  });

  it("does not turn colour on when NO_COLOR is set", () => {
    delete process.env.CLICOLOR;
    process.env.NO_COLOR = "1";
    expect(terminalEnv().CLICOLOR).toBeUndefined();
  });

  it("still strips provider secrets", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(terminalEnv().OPENAI_API_KEY).toBeUndefined();
  });

  it("strips the app's API and health tokens", () => {
    process.env.MARVEN_API_TOKEN = "api-secret";
    process.env.MARVEN_HEALTH_TOKEN = "health-secret";
    for (const env of [terminalEnv(), sanitizedEnv()]) {
      expect(env.MARVEN_API_TOKEN).toBeUndefined();
      expect(env.MARVEN_HEALTH_TOKEN).toBeUndefined();
    }
    // Only the copy is sanitized; the in-process server still sees them.
    expect(process.env.MARVEN_API_TOKEN).toBe("api-secret");
  });
});
