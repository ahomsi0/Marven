import { describe, it, expect } from "vitest";
import { parseNarratedToolCall } from "./parseNarratedToolCall";

describe("parseNarratedToolCall", () => {
  it("parses <function=name>{...}</function> (Llama 3.1 native)", () => {
    const out = parseNarratedToolCall(
      '<function=run_command>{"command": "npm start"}</function>',
    );
    expect(out).toEqual({ tool: "run_command", args: { command: "npm start" } });
  });

  it("parses <function(name){...}</function> (variant)", () => {
    const out = parseNarratedToolCall(
      '<function(run_command){"command": "npm start", "cwd": "/foo"}</function>',
    );
    expect(out).toEqual({
      tool: "run_command",
      args: { command: "npm start", cwd: "/foo" },
    });
  });

  it("parses <tool_call>{name,arguments}</tool_call> (Qwen)", () => {
    const out = parseNarratedToolCall(
      '<tool_call>{"name": "list_files", "arguments": {"path": "."}}</tool_call>',
    );
    expect(out).toEqual({ tool: "list_files", args: { path: "." } });
  });

  it("extracts a tool call wrapped in surrounding chatter", () => {
    const out = parseNarratedToolCall(
      'Let me run this for you: <function(run_command){"command": "ls"}</function> done.',
    );
    expect(out).toEqual({ tool: "run_command", args: { command: "ls" } });
  });

  it("returns null when no tool call is present", () => {
    expect(parseNarratedToolCall("just some prose")).toBeNull();
    expect(parseNarratedToolCall("")).toBeNull();
  });

  it("returns null when the args block is unparseable", () => {
    const out = parseNarratedToolCall(
      '<function(run_command){not json}</function>',
    );
    expect(out).toEqual({ tool: "run_command", args: {} });
  });
});
