// Turns a failed /api/chat call into a message worth showing in the thread.
// The chat route reports its own failures as `{ reply }` (missing key,
// provider down, …), which the caller shows as-is. What's left is either the
// request never getting an answer, or an answer that isn't a usable reply.

import i18n from "@/lib/i18n";
import type { ChatResponse } from "@/types";
import type { StreamError } from "@/lib/chatStream";

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

/** The reply had started streaming, then the connection dropped. */
export class ChatStreamInterruptedError extends Error {
  constructor(readonly cause?: unknown) {
    super("The chat stream was interrupted");
  }
}

export type ProviderErrorKind = "auth" | "rate_limit" | "model" | "unreachable" | "timeout" | "other";

/** Sort a provider failure into the few cases worth explaining differently. */
export function classifyProviderError(e: StreamError): ProviderErrorKind {
  if (e.status === 401 || e.status === 403) return "auth";
  if (e.status === 429) return "rate_limit";
  if (e.code === "unreachable") return "unreachable";
  if (e.code === "timeout") return "timeout";
  const text = `${e.code ?? ""} ${e.message}`.toLowerCase();
  if (
    e.status === 404 ||
    /model_not_found|model_decommissioned/.test(text) ||
    /\bmodel\b.*\b(not found|does not exist|decommissioned|not supported|unavailable|no longer)/.test(text)
  ) {
    return "model";
  }
  if (/invalid[_ ]api[_ ]key|authentication_error|unauthorized/.test(text)) return "auth";
  if (/rate[_ ]limit/.test(text)) return "rate_limit";
  return "other";
}

/** What to tell the user when the provider failed mid-reply (stream error sentinel). */
export function providerErrorMessage(e: StreamError): string {
  const provider = e.provider;
  switch (classifyProviderError(e)) {
    case "auth":
      return i18n.t("chat.errorBadKey", { provider });
    case "rate_limit":
      return i18n.t("chat.errorRateLimited", { provider });
    case "model":
      return e.model
        ? i18n.t("chat.errorModelUnavailable", { provider, model: e.model })
        : i18n.t("chat.errorModelUnavailableGeneric", { provider });
    case "unreachable":
      return i18n.t("chat.errorProviderUnreachable", { provider });
    case "timeout":
      return i18n.t("chat.errorProviderTimeout", { provider });
    default:
      return e.status !== undefined
        ? i18n.t("chat.errorProviderStatus", { provider, status: e.status, detail: e.message })
        : i18n.t("chat.errorProvider", { provider, detail: e.message });
  }
}

/** What to tell the user when sending a chat message fails. */
export function chatErrorMessage(err: unknown): string {
  if (err instanceof ChatStreamInterruptedError) return i18n.t("chat.errorStreamInterrupted");
  if (err instanceof ChatServerError) {
    return err.detail
      ? i18n.t("chat.errorServerDetail", { status: err.status, detail: err.detail })
      : i18n.t("chat.errorServer", { status: err.status });
  }
  // fetch() rejects with a TypeError when nothing answers at all.
  return i18n.t("chat.errorUnreachable");
}
