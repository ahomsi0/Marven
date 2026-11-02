import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  GROQ_MODELS,
  isChatCapableGroqModel,
  pickDefaultGroqModel,
  rankGroqModels,
} from "./groq";

// Roughly what Groq's /models returns.
const LIVE = [
  "allam-2-7b",
  "canopylabs/orpheus-v1-english",
  "groq/compound",
  "groq/compound-mini",
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-guard-4-12b",
  "meta-llama/llama-prompt-guard-2-86m",
  "moonshotai/kimi-k2-instruct-0905",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-safeguard-20b",
  "playai-tts",
  "qwen/qwen3-32b",
  "whisper-large-v3",
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
    for (const id of ["llama-3.3-70b-versatile", "groq/compound", "allam-2-7b", "qwen/qwen3-32b"]) {
      expect(isChatCapableGroqModel(id), id).toBe(true);
    }
  });
});

describe("rankGroqModels / pickDefaultGroqModel", () => {
  it("defaults to llama-3.3-70b-versatile, never the alphabetically-first model", () => {
    expect(pickDefaultGroqModel(LIVE)).toBe("llama-3.3-70b-versatile");
    expect(pickDefaultGroqModel(LIVE)).not.toBe("allam-2-7b");
  });

  it("falls through the preference list when the top pick is gone", () => {
    const without70b = LIVE.filter((id) => id !== "llama-3.3-70b-versatile");
    expect(pickDefaultGroqModel(without70b)).toBe("openai/gpt-oss-120b");
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
    for (const retired of ["llama3-8b-8192", "gemma2-9b-it", "mixtral-8x7b-32768"]) {
      expect(names).not.toContain(retired);
    }
    expect(rankGroqModels(names)).toEqual(names);
    expect(names[0]).toBe(DEFAULT_MODEL);
  });
});
