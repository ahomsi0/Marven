import { describe, it, expect } from "vitest";
import { extractJsonToolCall } from "./ollama";

describe("extractJsonToolCall", () => {
  it("parses {name, arguments} JSON form", () => {
    const text = `Sure — {"name": "run_command", "arguments": {"command": "ls"}}`;
    const r = extractJsonToolCall(text);
    expect(r).toEqual({ name: "run_command", args: { command: "ls" } });
  });

  it("parses {name, args} JSON form (shorthand)", () => {
    const text = `{"name": "read_file", "args": {"path": "foo.ts"}}`;
    const r = extractJsonToolCall(text);
    expect(r).toEqual({ name: "read_file", args: { path: "foo.ts" } });
  });

  it("parses function-call syntax that qwen2.5-coder emits", () => {
    const text = `Run the following: run_command({"command": "python -m http.server 8000", "cwd": "."})`;
    const r = extractJsonToolCall(text);
    expect(r).toEqual({
      name: "run_command",
      args: { command: "python -m http.server 8000", cwd: "." },
    });
  });

  it("parses function-call syntax for read_file with quoted paths", () => {
    const text = `Let me check it: read_file({"path": "src/index.ts"})`;
    expect(extractJsonToolCall(text)).toEqual({
      name: "read_file",
      args: { path: "src/index.ts" },
    });
  });

  it("ignores function-call syntax for unknown tool names", () => {
    const text = `someRandomFn({"key": "value"})`;
    expect(extractJsonToolCall(text)).toBeNull();
  });

  it("returns null when no tool call present", () => {
    expect(extractJsonToolCall("Just plain text with no tool call.")).toBeNull();
  });

  it("handles braces inside string args without confusing depth tracking", () => {
    const text = `write_file({"path": "x.json", "content": "{\\"hello\\": \\"world\\"}"})`;
    const r = extractJsonToolCall(text);
    expect(r?.name).toBe("write_file");
    expect(r?.args.path).toBe("x.json");
    expect(r?.args.content).toBe('{"hello": "world"}');
  });
});
