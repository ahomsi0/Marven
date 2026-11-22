import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "module";
import { SECRET_ENV_KEYS, sanitizedChildEnv } from "./sanitizedEnv";

const require = createRequire(import.meta.url);
const electronSanitizer = require("../../electron/envSanitize") as { SECRET_ENV_KEYS: string[] };

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe("sanitizedChildEnv", () => {
  it("strips the app's API and health tokens", () => {
    process.env.MARVEN_API_TOKEN = "api-secret";
    process.env.MARVEN_HEALTH_TOKEN = "health-secret";
    const env = sanitizedChildEnv();
    expect(env.MARVEN_API_TOKEN).toBeUndefined();
    expect(env.MARVEN_HEALTH_TOKEN).toBeUndefined();
    // The server process itself keeps them.
    expect(process.env.MARVEN_API_TOKEN).toBe("api-secret");
  });

  it("strips provider keys and keeps everything else", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.MARVEN_TEST_KEEP = "1";
    const env = sanitizedChildEnv({ EXTRA: "x" });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.MARVEN_TEST_KEEP).toBe("1");
    expect(env.EXTRA).toBe("x");
  });

  it("strips the same keys as the Electron main-process sanitizer", () => {
    expect([...SECRET_ENV_KEYS].sort()).toEqual([...electronSanitizer.SECRET_ENV_KEYS].sort());
  });
});
