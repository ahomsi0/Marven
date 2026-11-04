import { describe, expect, it } from "vitest";
import {
  browserSecretRefusal, canSeeImages, isActingBrowserTool, isBrowserTool, secretValuesFromEnv,
} from "./browserGate";
import { BROWSER_TOOL_DEFINITIONS, BROWSER_PROMPT_SECTION } from "./browserTools";

describe("browser tool names", () => {
  it("defines 11 tools, all recognised", () => {
    expect(BROWSER_TOOL_DEFINITIONS).toHaveLength(11);
    for (const def of BROWSER_TOOL_DEFINITIONS) expect(isBrowserTool(def.name)).toBe(true);
    expect(isBrowserTool("read_file")).toBe(false);
  });

  it("marks click, type, press and select as acting", () => {
    expect(["browser_click", "browser_type", "browser_press", "browser_select"].every(isActingBrowserTool)).toBe(true);
    expect(["browser_open", "browser_read", "browser_scroll", "browser_screenshot"].some(isActingBrowserTool)).toBe(false);
  });

  it("tells the model page content is untrusted", () => {
    expect(BROWSER_PROMPT_SECTION).toMatch(/untrusted/i);
  });
});

describe("browserSecretRefusal", () => {
  it("refuses typing or opening a secret", () => {
    expect(browserSecretRefusal("browser_type", { text: "sk-ant-api03-abcdefghijkl" }, [])).toMatch(/secret/);
    expect(browserSecretRefusal("browser_open", { url: "https://x.test/?k=my-own-key-123456" }, ["my-own-key-123456"])).toMatch(/secret/);
  });

  it("lets ordinary input through and ignores other tools", () => {
    expect(browserSecretRefusal("browser_type", { text: "ada@example.com" }, [])).toBeNull();
    expect(browserSecretRefusal("browser_read", { find: "sk-ant-api03-abcdefghijkl" }, [])).toBeNull();
  });
});

describe("canSeeImages", () => {
  it("is true for Anthropic and OpenAI, and Groq vision models only", () => {
    expect(canSeeImages("anthropic", "claude-sonnet-5-5")).toBe(true);
    expect(canSeeImages("openai", "gpt-4.1")).toBe(true);
    expect(canSeeImages("ollama", "llava")).toBe(false);
    expect(canSeeImages("openrouter", "anything")).toBe(false);
  });
});

describe("secretValuesFromEnv", () => {
  it("collects *_API_KEY and *_TOKEN values of a useful length", () => {
    expect(secretValuesFromEnv({ GROQ_API_KEY: "gsk_0123456789abcdef", GITHUB_TOKEN: "short", HOME: "/Users/x" }))
      .toEqual(["gsk_0123456789abcdef"]);
  });
});
