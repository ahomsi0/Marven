import { describe, it, expect } from "vitest";
import {
  ChatServerError,
  ChatStreamInterruptedError,
  chatErrorMessage,
  classifyProviderError,
  providerErrorMessage,
  readChatReply,
} from "./chatErrors";

const response = (body: string, status = 200) => new Response(body, { status });

describe("readChatReply", () => {
  it("returns the parsed reply, including the route's own error replies", async () => {
    expect((await readChatReply(response('{"reply":"hi"}'))).reply).toBe("hi");
    expect((await readChatReply(response('{"reply":"LM Studio is not running."}', 503))).reply).toBe(
      "LM Studio is not running.",
    );
  });

  it("throws ChatServerError with the server's error text when there is no reply", async () => {
    const err = await readChatReply(response('{"error":"Non-loopback Host rejected"}', 403)).catch((e) => e);
    expect(err).toBeInstanceOf(ChatServerError);
    expect(err.status).toBe(403);
    expect(err.detail).toBe("Non-loopback Host rejected");
  });

  it("throws ChatServerError for a non-JSON body like an HTML error page", async () => {
    const err = await readChatReply(response("<!DOCTYPE html><html>Internal Server Error</html>", 500)).catch((e) => e);
    expect(err).toBeInstanceOf(ChatServerError);
    expect(err.status).toBe(500);
    expect(err.detail).toBe("");
  });
});

describe("chatErrorMessage", () => {
  it("explains an unreachable server instead of a generic connection error", () => {
    const msg = chatErrorMessage(new TypeError("Failed to fetch"));
    expect(msg).toContain("Couldn't reach Marven's local server");
    expect(msg).toContain("wasn't sent");
  });

  it("includes the status, and the server's detail when it gave one", () => {
    expect(chatErrorMessage(new ChatServerError(500, ""))).toContain("error 500");
    expect(chatErrorMessage(new ChatServerError(403, "Non-loopback Host rejected"))).toContain(
      "error 403: Non-loopback Host rejected",
    );
  });
});

describe("classifyProviderError", () => {
  const e = (over: object) => ({ provider: "Groq", message: "", ...over });

  it("maps statuses to the cases we explain differently", () => {
    expect(classifyProviderError(e({ status: 401 }))).toBe("auth");
    expect(classifyProviderError(e({ status: 403 }))).toBe("auth");
    expect(classifyProviderError(e({ status: 429 }))).toBe("rate_limit");
    expect(classifyProviderError(e({ status: 404 }))).toBe("model");
    expect(classifyProviderError(e({ code: "unreachable" }))).toBe("unreachable");
    expect(classifyProviderError(e({ code: "timeout" }))).toBe("timeout");
  });

  it("recognises model errors that don't come back as 404", () => {
    expect(classifyProviderError(e({ status: 400, code: "model_decommissioned", message: "gone" }))).toBe("model");
    expect(
      classifyProviderError(e({ status: 400, message: "The model `foo` does not exist or you do not have access to it." })),
    ).toBe("model");
  });

  it("falls back to other", () => {
    expect(classifyProviderError(e({ status: 500, message: "Internal error" }))).toBe("other");
  });
});

describe("providerErrorMessage", () => {
  it("explains a bad key, a rate limit and a missing model", () => {
    expect(providerErrorMessage({ provider: "Groq", status: 401, message: "Invalid API Key" })).toContain(
      "Groq rejected the API key",
    );
    expect(providerErrorMessage({ provider: "OpenAI", status: 429, message: "x" })).toContain("rate-limiting");
    expect(providerErrorMessage({ provider: "Ollama", model: "phi3", status: 404, message: "x" })).toContain(
      "phi3 isn't available on Ollama",
    );
  });

  it("passes the provider's own text through otherwise", () => {
    expect(providerErrorMessage({ provider: "NVIDIA NIM", status: 500, message: "Upstream exploded" })).toBe(
      "NVIDIA NIM returned an error (500): Upstream exploded",
    );
    expect(providerErrorMessage({ provider: "LM Studio", code: "unreachable", message: "fetch failed" })).toContain(
      "Couldn't connect to LM Studio",
    );
  });
});

describe("chatErrorMessage for an interrupted stream", () => {
  it("says the reply was cut off, not that the server was unreachable", () => {
    const msg = chatErrorMessage(new ChatStreamInterruptedError(new TypeError("network error")));
    expect(msg).toContain("cut off");
    expect(msg).not.toContain("Couldn't reach");
  });
});
