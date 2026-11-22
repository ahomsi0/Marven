import { describe, it, expect, vi, afterEach } from "vitest";
import { localOpenAiAgentStep, parseLocalCompletion } from "./localOpenAi";
import { defaultAgentModel, makeAgentProviderStep } from "./providerRouting";
import { ollamaAgentStep } from "./ollama";
import type { ToolDefinition } from "@/types";

const TOOLS: ToolDefinition[] = [
  { name: "read_file", description: "read", parameters: { type: "object", properties: {}, required: [] } } as unknown as ToolDefinition,
];

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const textReply = (content: string) => ({ choices: [{ message: { content } }] });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseLocalCompletion", () => {
  it("maps a single native tool call", () => {
    const r = parseLocalCompletion({
      choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] } }],
    }, "lmstudio");
    expect(r).toEqual({ type: "tool_call", callId: "c1", tool: "read_file", args: { path: "a.ts" } });
  });

  it("maps parallel native tool calls", () => {
    const r = parseLocalCompletion({
      choices: [{ message: { tool_calls: [
        { id: "a", function: { name: "read_file", arguments: { path: "x" } } },
        { id: "b", function: { name: "list_files", arguments: "{}" } },
      ] } }],
    }, "llamaserver");
    expect(r.type).toBe("tool_calls");
  });

  it("falls back to inline JSON tool calls in text", () => {
    const r = parseLocalCompletion(textReply('{"name":"read_file","arguments":{"path":"b.ts"}}'), "lmstudio");
    expect(r).toMatchObject({ type: "tool_call", tool: "read_file", args: { path: "b.ts" } });
  });

  it("falls back to narrated <function=...> tool calls", () => {
    const r = parseLocalCompletion(textReply('<function=read_file>{"path":"c.ts"}</function>'), "lmstudio");
    expect(r).toMatchObject({ type: "tool_call", tool: "read_file", args: { path: "c.ts" } });
  });

  it("returns plain text otherwise", () => {
    expect(parseLocalCompletion(textReply("  Done.  "), "lmstudio")).toEqual({ type: "text", content: "Done." });
  });
});

describe("localOpenAiAgentStep", () => {
  it("posts to LM_STUDIO_URL, read on every call", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { urls.push(url); return okJson(textReply("ok")); }));
    vi.stubEnv("LM_STUDIO_URL", "http://127.0.0.1:1111/");
    await localOpenAiAgentStep("lmstudio", [{ role: "user", content: "hi" }], TOOLS, "m");
    vi.stubEnv("LM_STUDIO_URL", "http://127.0.0.1:2222");
    await localOpenAiAgentStep("lmstudio", [{ role: "user", content: "hi" }], TOOLS, "m");
    expect(urls).toEqual([
      "http://127.0.0.1:1111/v1/chat/completions",
      "http://127.0.0.1:2222/v1/chat/completions",
    ]);
  });

  it("posts to LLAMA_SERVER_URL with tools in OpenAI shape", async () => {
    let seen: { url: string; body: Record<string, unknown> } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(init.body as string) };
      return okJson(textReply("ok"));
    }));
    vi.stubEnv("LLAMA_SERVER_URL", "http://127.0.0.1:9999");
    await localOpenAiAgentStep("llamaserver", [{ role: "user", content: "hi" }], TOOLS, "local-model");
    expect(seen!.url).toBe("http://127.0.0.1:9999/v1/chat/completions");
    expect(seen!.body.model).toBe("local-model");
    expect(seen!.body.tools).toEqual([{ type: "function", function: TOOLS[0] }]);
  });

  it("retries without tools when the server rejects the tools field", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      if (body.tools) return new Response("tools param requires --jinja flag", { status: 500 });
      return okJson(textReply('<function=read_file>{"path":"d.ts"}</function>'));
    }));
    const r = await localOpenAiAgentStep("llamaserver", [{ role: "user", content: "hi" }], TOOLS, "m");
    expect(bodies).toHaveLength(2);
    expect(bodies[1].tools).toBeUndefined();
    expect(r).toMatchObject({ type: "tool_call", tool: "read_file" });
  });

  it("reports a connection failure naming the server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(localOpenAiAgentStep("lmstudio", [{ role: "user", content: "hi" }], TOOLS, "m"))
      .rejects.toThrow(/LM Studio/);
  });
});

describe("provider routing", () => {
  it("never defaults LM Studio / llama-server to an Ollama model tag", () => {
    expect(defaultAgentModel("lmstudio")).toBe("local-model");
    expect(defaultAgentModel("llamaserver")).toBe("local-model");
    expect(defaultAgentModel("ollama")).toBe("qwen2.5-coder");
  });

  it("routes lmstudio and llamaserver to their own servers, not Ollama", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { urls.push(url); return okJson(textReply("ok")); }));
    vi.stubEnv("LM_STUDIO_URL", "http://lms.local:1234");
    vi.stubEnv("LLAMA_SERVER_URL", "http://llama.local:8080");
    await makeAgentProviderStep("lmstudio", "m")([{ role: "user", content: "hi" }], TOOLS);
    await makeAgentProviderStep("llamaserver", "m")([{ role: "user", content: "hi" }], TOOLS);
    expect(urls).toEqual([
      "http://lms.local:1234/v1/chat/completions",
      "http://llama.local:8080/v1/chat/completions",
    ]);
  });
});

describe("ollamaAgentStep URL", () => {
  it("reads OLLAMA_URL on every call", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return okJson({ message: { content: "ok" } });
    }));
    vi.stubEnv("OLLAMA_URL", "http://10.0.0.5:11434");
    await ollamaAgentStep([{ role: "user", content: "hi" }], TOOLS, "qwen2.5-coder");
    vi.stubEnv("OLLAMA_URL", "http://10.0.0.6:11434/");
    await ollamaAgentStep([{ role: "user", content: "hi" }], TOOLS, "qwen2.5-coder");
    expect(urls).toEqual(["http://10.0.0.5:11434/api/chat", "http://10.0.0.6:11434/api/chat"]);
  });
});
