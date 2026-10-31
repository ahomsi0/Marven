import { describe, it, expect } from "vitest";
import { ChatServerError, chatErrorMessage, readChatReply } from "./chatErrors";

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
