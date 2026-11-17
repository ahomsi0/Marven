import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  GROQ_MODELS,
  isChatCapableGroqModel,
  pickDefaultGroqModel,
  rankGroqModels,
} from "./groq";

// Roughly what Groq's /models returns (late 2026; the Llama 3.x ids only show
// up for Enterprise accounts).
const LIVE = [
  "allam-2-7b",
  "canopylabs/orpheus-v1-english",
  "groq/compound",
  "groq/compound-mini",
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-guard-4-12b",
  "meta-llama/llama-prompt-guard-2-86m",
  "minimaxai/minimax-m2.7",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-safeguard-20b",
  "playai-tts",
  "qwen/qwen3.8-27b",
  "whisper-large-v3",
  "whisper-large-v3-turbo",
  "distil-whisper-large-v3-en",
];

describe("isChatCapableGroqModel", () => {
  it("drops speech, TTS and moderation models", () => {
    for (const id of [
      "whisper-large-v3",
      "distil-whisper-large-v3-en",
      "playai-tts",
      "canopylabs/orpheus-v1-english",
      "meta-llama/llama-guard-4-12b",
      "meta-llama/llama-prompt-guard-2-86m",
      "openai/gpt-oss-safeguard-20b",
    ]) {
      expect(isChatCapableGroqModel(id), id).toBe(false);
    }
  });

  it("keeps chat models, including compound and allam", () => {
    for (const id of ["openai/gpt-oss-120b", "groq/compound", "allam-2-7b", "qwen/qwen3.8-27b"]) {
      expect(isChatCapableGroqModel(id), id).toBe(true);
    }
  });
});

describe("rankGroqModels / pickDefaultGroqModel", () => {
  it("defaults to openai/gpt-oss-120b, never the alphabetically-first model", () => {
    expect(pickDefaultGroqModel(LIVE)).toBe("openai/gpt-oss-120b");
    expect(pickDefaultGroqModel(LIVE)).not.toBe("allam-2-7b");
  });

  it("falls through the preference list when the top pick is gone", () => {
    const without120b = LIVE.filter((id) => id !== "openai/gpt-oss-120b");
    expect(pickDefaultGroqModel(without120b)).toBe("qwen/qwen3.8-27b");
  });

  it("prefers unknown llama/qwen/gpt-oss models (bigger first) over the rest", () => {
    expect(rankGroqModels(["allam-2-7b", "groq/compound", "qwen/qwen4-14b", "llama-5-400b-chat"])).toEqual([
      "llama-5-400b-chat",
      "qwen/qwen4-14b",
      "allam-2-7b",
      "groq/compound",
    ]);
  });

  it("still picks something when nothing is preferred, and the built-in default when empty", () => {
    expect(pickDefaultGroqModel(["zeta-chat", "alpha-chat"])).toBe("alpha-chat");
    expect(pickDefaultGroqModel([])).toBe(DEFAULT_MODEL);
    expect(pickDefaultGroqModel(["whisper-large-v3"])).toBe(DEFAULT_MODEL);
  });

  it("keeps the offline fallback list free of retired models, best first", () => {
    const names = GROQ_MODELS.map((m) => m.name);
    for (const retired of [
      "llama3-8b-8192",
      "gemma2-9b-it",
      "mixtral-8x7b-32768",
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "qwen/qwen3-32b",
      "meta-llama/llama-4-scout-17b-16e-instruct",
    ]) {
      expect(names).not.toContain(retired);
    }
    expect(rankGroqModels(names)).toEqual(names);
    expect(names[0]).toBe(DEFAULT_MODEL);
  });
});
