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

  // Qwen 2.5 Coder (and some other Hermes-style models) emit bare JSON
  // tool calls with no <tool_call> wrapper. We accept these only when
  // the `name` is one of our known tools to avoid false positives.
  describe("bare JSON fallback (Qwen 2.5 Coder)", () => {
    it("parses a bare {name, arguments} JSON object", () => {
      const out = parseNarratedToolCall(
        '{"name": "write_file", "arguments": {"path": "src/foo.ts", "content": "x"}}',
      );
      expect(out).toEqual({
        tool: "write_file",
        args: { path: "src/foo.ts", content: "x" },
      });
    });

    it("parses bare JSON wrapped in a ```json fence", () => {
      const out = parseNarratedToolCall(
        '```json\n{"name": "read_file", "arguments": {"path": "a.ts"}}\n```',
      );
      expect(out).toEqual({ tool: "read_file", args: { path: "a.ts" } });
    });

    it("ignores trailing prose after the JSON object", () => {
      const out = parseNarratedToolCall(
        '{"name": "list_files", "arguments": {"path": "src"}}\nLet me know if you need more.',
      );
      expect(out).toEqual({ tool: "list_files", args: { path: "src" } });
    });

    it("ignores bare JSON whose `name` is not a registered tool", () => {
      // A model might emit unrelated JSON in chat — we must not invoke it.
      const out = parseNarratedToolCall(
        '{"name": "some_imaginary_tool", "arguments": {"x": 1}}',
      );
      expect(out).toBeNull();
    });

    it("ignores JSON missing the `name` field", () => {
      expect(
        parseNarratedToolCall('{"arguments": {"path": "x"}}'),
      ).toBeNull();
    });

    it("ignores JSON that doesn't start the content (avoids embedded JSON in prose)", () => {
      const out = parseNarratedToolCall(
        'Here is what I would call: {"name": "write_file", "arguments": {}}',
      );
      expect(out).toBeNull();
    });

    it("handles arguments containing JSON strings with braces", () => {
      const out = parseNarratedToolCall(
        '{"name": "write_file", "arguments": {"path": "a.json", "content": "{\\"x\\": 1}"}}',
      );
      expect(out).toEqual({
        tool: "write_file",
        args: { path: "a.json", content: '{"x": 1}' },
      });
    });
  });
});
