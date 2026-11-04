import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { containsSecret, redactText, redactLines } from "./redact";

// electron/redact.js is the main process's CommonJS copy; both must agree.
const require = createRequire(import.meta.url);
const electronRedact = require("../electron/redact") as {
  redactText: typeof redactText;
  redactLines: typeof redactLines;
};

const impls = [
  ["lib/redact.ts", redactText],
  ["electron/redact.js", electronRedact.redactText],
] as const;

describe.each(impls)("%s", (_name, redact) => {
  it("redacts provider API keys", () => {
    const out = redact(
      [
        "openai sk-proj-abcdefghijklmnop1234567890",
        "anthropic sk-ant-api03-AbCdEf123456_-xyz",
        "openrouter sk-or-v1-0123456789abcdef",
        "groq gsk_ABCDEFGHIJKLMNOP1234",
        "nim nvapi-abcdefghijklmnopqrstu-123",
      ].join("\n"),
    );
    expect(out).not.toMatch(/sk-proj|sk-ant-api|sk-or-v1|gsk_A|nvapi-a/);
    expect(out.match(/\[REDACTED_KEY\]/g)).toHaveLength(5);
  });

  it("redacts bearer tokens", () => {
    expect(redact("Authorization: Bearer abc.def-ghi")).toBe("Authorization: Bearer [REDACTED_TOKEN]");
  });

  it("redacts long hex and base64 tokens but keeps long plain identifiers", () => {
    expect(redact("token=0123456789abcdef0123456789abcdef")).toBe("token=[REDACTED_TOKEN]");
    expect(redact("x QWxhZGRpbjpvcGVuIHNlc2FtZQ1234567890abc== y")).toBe("x [REDACTED_TOKEN] y");
    expect(redact("some_really_long_function_name_without_numbers")).toBe(
      "some_really_long_function_name_without_numbers",
    );
    // Short hex (commit SHAs, ports) is fine.
    expect(redact("commit 8e60f29 on port 47891")).toBe("commit 8e60f29 on port 47891");
  });

  it("redacts email addresses", () => {
    expect(redact("sent to jane.doe+test@example.co.uk ok")).toBe("sent to [REDACTED_EMAIL] ok");
  });

  it("replaces the home directory with ~", () => {
    expect(redact("open /Users/jane/Projects/app/x.ts", { homeDir: "/Users/jane" })).toBe(
      "open ~/Projects/app/x.ts",
    );
    expect(redact("cwd=/home/bob/work")).toBe("cwd=~/work");
    expect(redact("at C:\\Users\\Bob\\app\\main.js")).toBe("at ~\\app\\main.js");
    // A custom home outside /Users is still handled when passed in.
    expect(redact("/srv/me/data", { homeDir: "/srv/me/" })).toBe("~/data");
  });

  it("returns an empty string for empty input", () => {
    expect(redact("")).toBe("");
  });
});

describe("redactLines", () => {
  it("redacts each line", () => {
    expect(redactLines(["a gsk_ABCDEFGHIJKLMNOP1234", "b"])).toEqual(["a [REDACTED_KEY]", "b"]);
    expect(electronRedact.redactLines(["a gsk_ABCDEFGHIJKLMNOP1234", "b"])).toEqual([
      "a [REDACTED_KEY]",
      "b",
    ]);
  });
});

describe("containsSecret", () => {
  it("spots provider keys and bearer tokens", () => {
    expect(containsSecret("key sk-ant-api03-abcdefghijkl")).toBe(true);
    expect(containsSecret("sk-or-v1-abcdefghij")).toBe(true);
    expect(containsSecret("sk-abcdefghijklmnopqrst")).toBe(true);
    expect(containsSecret("gsk_abcdefghijklmnopqrst")).toBe(true);
    expect(containsSecret("nvapi-abcdefghijklmnopqrst")).toBe(true);
    expect(containsSecret("Authorization: Bearer abc.def.ghi")).toBe(true);
    expect(containsSecret("ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toBe(true);
    expect(containsSecret("github_pat_11ABCDEFG0123456789_abcdefghij")).toBe(true);
    expect(containsSecret("AKIAABCDEFGHIJKLMNOP")).toBe(true);
  });

  it("finds known secret values anywhere in the text", () => {
    expect(containsSecret("https://x.test/?d=my-own-key-123456", ["my-own-key-123456"])).toBe(true);
  });

  it("ignores short known values and ordinary text", () => {
    expect(containsSecret("hello", ["hello"])).toBe(false);
    expect(containsSecret("Search for running shoes size 42")).toBe(false);
    expect(containsSecret("https://example.com/products/0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(false);
    expect(containsSecret("ada@example.com")).toBe(false);
    expect(containsSecret("")).toBe(false);
  });
});
