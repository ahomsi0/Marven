import { describe, expect, it } from "vitest";
import { isLikelyVisionModel, isLocalProvider } from "./visionModels";

describe("isLikelyVisionModel", () => {
  it.each([
    "llava",
    "llava:13b",
    "bakllava:latest",
    "llava-phi3",
    "llama3.2-vision:11b",
    "llama4:scout",
    "meta-llama/llama-4-scout-17b",
    "qwen2.5vl:7b",
    "qwen/qwen2.5-vl-7b-instruct",
    "qwen2-vl",
    "Qwen-VL-Chat",
    "qwen3-vl:8b",
    "gemma3",
    "gemma3:4b",
    "gemma3:12b",
    "google/gemma-3-27b-it",
    "gemma-3-4b-it-Q4_K_M.gguf",
    "minicpm-v:8b",
    "moondream",
    "mistral-small3.1:24b",
    "mistralai/mistral-small-3.2-24b-instruct",
    "granite3.2-vision",
    "pixtral-12b",
    "some-model-vl-7b",
  ])("treats %s as vision-capable", (model) => {
    expect(isLikelyVisionModel("ollama", model)).toBe(true);
  });

  it.each([
    "",
    "phi3",
    "llama3.2",
    "llama3.1:8b",
    "mistral",
    "mistral-small:22b",
    "qwen2.5:7b",
    "qwen2.5-coder",
    "deepseek-r1",
    "gemma3:1b",
    "google/gemma-3-1b-it",
    "gemma3:270m",
    "gemma3n:e4b",
    "gemma2:9b",
    "local-model",
    "devlin", // contains "vl" but not as "-vl"
  ])("treats %s as text-only", (model) => {
    expect(isLikelyVisionModel("lmstudio", model)).toBe(false);
  });
});

describe("isLocalProvider", () => {
  it("knows the local backends", () => {
    expect(isLocalProvider("ollama")).toBe(true);
    expect(isLocalProvider("lmstudio")).toBe(true);
    expect(isLocalProvider("llamaserver")).toBe(true);
    expect(isLocalProvider("openai")).toBe(false);
    expect(isLocalProvider("groq")).toBe(false);
  });
});
