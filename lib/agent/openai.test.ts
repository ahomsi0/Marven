import { beforeEach, describe, expect, it } from "vitest";
import type {
  ResponseFunctionToolCall,
  ResponseOutputItem,
  ResponseReasoningItem,
} from "openai/resources/responses/responses";
import type { InternalMessage } from "@/types";
import { clearOpenAIReplayCache, stepFromResponseOutput, toResponsesInput } from "./openai";
import { OPENAI_REFUSAL_MESSAGE } from "@/lib/openai";

const reasoning = (id: string): ResponseReasoningItem => ({
  type: "reasoning",
  id,
  summary: [],
  encrypted_content: `enc-${id}`,
});

const call = (callId: string, name: string, args: object): ResponseFunctionToolCall => ({
  type: "function_call",
  id: `fc_${callId}`,
  call_id: callId,
  name,
  arguments: JSON.stringify(args),
  status: "completed",
});

beforeEach(() => clearOpenAIReplayCache());

describe("toResponsesInput", () => {
  it("maps system, user (with images), assistant, tool call and tool result", () => {
    const msgs: InternalMessage[] = [
      { role: "system", content: "sys" },
      {
        role: "user",
        content: "look",
        attachments: [{ base64: "data:image/png;base64,AAA", mimeType: "image/png", name: "a.png" }],
      },
      { role: "assistant", content: "ok" },
      { role: "assistant_tool_call", callId: "c1", tool: "read_file", args: { path: "a.ts" } },
      { role: "tool_result", callId: "c1", content: "file body" },
    ];
    expect(toResponsesInput(msgs)).toEqual([
      { role: "system", content: "sys" },
      {
        role: "user",
        content: [
          { type: "input_text", text: "look" },
          { type: "input_image", image_url: "data:image/png;base64,AAA", detail: "auto" },
        ],
      },
      { role: "assistant", content: "ok" },
      { type: "function_call", call_id: "c1", name: "read_file", arguments: '{"path":"a.ts"}' },
      { type: "function_call_output", call_id: "c1", output: "file body" },
    ]);
  });

  it("replays the reasoning and original call items OpenAI returned", () => {
    const output: ResponseOutputItem[] = [
      reasoning("rs_1"),
      call("c1", "read_file", { path: "a.ts" }),
      call("c2", "read_file", { path: "b.ts" }),
    ];
    stepFromResponseOutput(output, "");

    const input = toResponsesInput([
      { role: "user", content: "go" },
      { role: "assistant_tool_call", callId: "c1", tool: "read_file", args: { path: "a.ts" } },
      { role: "tool_result", callId: "c1", content: "A" },
      { role: "assistant_tool_call", callId: "c2", tool: "read_file", args: { path: "b.ts" } },
      { role: "tool_result", callId: "c2", content: "B" },
    ]);
    expect(input).toEqual([
      { role: "user", content: "go" },
      reasoning("rs_1"),
      call("c1", "read_file", { path: "a.ts" }),
      { type: "function_call_output", call_id: "c1", output: "A" },
      call("c2", "read_file", { path: "b.ts" }),
      { type: "function_call_output", call_id: "c2", output: "B" },
    ]);
  });
});

describe("stepFromResponseOutput", () => {
  it("returns a single tool call", () => {
    expect(stepFromResponseOutput([reasoning("r"), call("c1", "list_dir", { path: "." })], "")).toEqual({
      type: "tool_call",
      callId: "c1",
      tool: "list_dir",
      args: { path: "." },
    });
  });

  it("returns parallel tool calls", () => {
    const r = stepFromResponseOutput([call("c1", "a", {}), call("c2", "b", { x: 1 })], "");
    expect(r).toEqual({
      type: "tool_calls",
      calls: [
        { callId: "c1", tool: "a", args: {} },
        { callId: "c2", tool: "b", args: { x: 1 } },
      ],
    });
  });

  it("returns text, and a notice when the model only refused", () => {
    expect(stepFromResponseOutput([], "  done  ")).toEqual({ type: "text", content: "done" });
    const refusal: ResponseOutputItem = {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "refusal", refusal: "no" }],
    };
    expect(stepFromResponseOutput([refusal], "")).toEqual({ type: "text", content: OPENAI_REFUSAL_MESSAGE });
  });
});
