import { describe, expect, it } from "vitest";
import { BROWSER_TOOL_DEFINITIONS } from "./browserTools";
import { AGENT_TOOLS } from "@/electron/browser/validate.js";
import { AGENT_KEYS } from "@/electron/browser/agentKeys.js";

describe("browser tool definitions", () => {
  it("are exactly the tools the main process accepts", () => {
    expect(BROWSER_TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual([...AGENT_TOOLS].sort());
  });

  it("offer exactly the keys the main process can press", () => {
    const press = BROWSER_TOOL_DEFINITIONS.find((t) => t.name === "browser_press")!;
    const key = (press.parameters.properties as Record<string, { enum?: string[] }>).key;
    expect([...(key.enum ?? [])].sort()).toEqual([...AGENT_KEYS].sort());
    expect(press.description).toContain(AGENT_KEYS.join(", ").replace(/, (\w+)$/, " or $1"));
  });
});
