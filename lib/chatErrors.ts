// Turns a failed /api/chat call into a message worth showing in the thread.
// The chat route reports its own failures as `{ reply }` (missing key,
// provider down, …), which the caller shows as-is. What's left is either the
// request never getting an answer, or an answer that isn't a usable reply.

import i18n from "@/lib/i18n";
import type { ChatResponse } from "@/types";

/** The server answered, but not with a usable `{ reply }`. */
export class ChatServerError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Chat request failed with ${status}${detail ? `: ${detail}` : ""}`);
  }
}

/** Parse a non-streaming /api/chat response, or throw ChatServerError. */
export async function readChatReply(res: Response): Promise<ChatResponse> {
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON — e.g. Next.js's HTML error page while the dev server rebuilds.
    throw new ChatServerError(res.status, "");
  }
  const reply = (data as { reply?: unknown })?.reply;
  if (typeof reply === "string") return data as ChatResponse;
  const error = (data as { error?: unknown })?.error;
  throw new ChatServerError(res.status, typeof error === "string" ? error : "");
}

/** What to tell the user when sending a chat message fails. */
export function chatErrorMessage(err: unknown): string {
  if (err instanceof ChatServerError) {
    return err.detail
      ? i18n.t("chat.errorServerDetail", { status: err.status, detail: err.detail })
      : i18n.t("chat.errorServer", { status: err.status });
  }
  // fetch() rejects with a TypeError when nothing answers at all.
  return i18n.t("chat.errorUnreachable");
}
