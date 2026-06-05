import { describe, it, expect } from "vitest";
import {
  VISION_PROVIDERS,
  buildOpenAIContent,
  buildAnthropicContent,
  stripAttachments,
  groqModelSupportsVision,
  groqUserMessageContent,
} from "./imageHelpers";
import type { ImageAttachment } from "@/types";

const IMG: ImageAttachment = {
  base64: "data:image/png;base64,abc123",
  mimeType: "image/png",
  name: "test.png",
};

describe("groqModelSupportsVision", () => {
  it("is true for documented Llama 4 vision model ids", () => {
    expect(groqModelSupportsVision("meta-llama/llama-4-scout-17b-16e-instruct")).toBe(true);
    expect(groqModelSupportsVision("meta-llama/llama-4-maverick-17b-128e-instruct")).toBe(true);
  });
  it("is false for text-only Groq chat models", () => {
    expect(groqModelSupportsVision("llama-3.1-8b-instant")).toBe(false);
    expect(groqModelSupportsVision("llama-3.3-70b-versatile")).toBe(false);
  });
});

describe("groqUserMessageContent", () => {
  it("returns multipart content for vision models when attachments exist", () => {
    const out = groqUserMessageContent("hi", [IMG], "meta-llama/llama-4-scout-17b-16e-instruct");
    expect(Array.isArray(out)).toBe(true);
  });
  it("returns string with strip note for text models when attachments exist", () => {
    const out = groqUserMessageContent("hi", [IMG], "llama-3.1-8b-instant");
    expect(typeof out).toBe("string");
    expect(out).toContain("hi");
    expect(out).toContain("text-only");
  });
  it("returns plain text when no attachments", () => {
    expect(groqUserMessageContent("hello", undefined, "llama-3.1-8b-instant")).toBe("hello");
  });
});

describe("VISION_PROVIDERS", () => {
  it("includes groq, openai, anthropic", () => {
    expect(VISION_PROVIDERS.has("groq")).toBe(true);
    expect(VISION_PROVIDERS.has("openai")).toBe(true);
    expect(VISION_PROVIDERS.has("anthropic")).toBe(true);
  });
  it("does not include ollama or nim", () => {
    expect(VISION_PROVIDERS.has("ollama")).toBe(false);
    expect(VISION_PROVIDERS.has("nim")).toBe(false);
  });
});

describe("buildOpenAIContent", () => {
  it("returns plain string when no attachments", () => {
    expect(buildOpenAIContent("hello", [])).toBe("hello");
  });

  it("returns array with text and image_url parts", () => {
    const result = buildOpenAIContent("describe this", [IMG]) as Array<Record<string, unknown>>;
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toEqual({ type: "text", text: "describe this" });
    expect(result[1]).toMatchObject({ type: "image_url", image_url: { url: IMG.base64 } });
  });
});

describe("buildAnthropicContent", () => {
  it("returns plain string when no attachments", () => {
    expect(buildAnthropicContent("hello", [])).toBe("hello");
  });

  it("returns array with image first, text second", () => {
    const result = buildAnthropicContent("describe this", [IMG]) as Array<Record<string, unknown>>;
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } });
    expect(result[1]).toEqual({ type: "text", text: "describe this" });
  });
});

describe("stripAttachments", () => {
  it("returns original text when no attachments", () => {
    expect(stripAttachments("hello", [])).toBe("hello");
  });

  it("appends removal note when attachments present", () => {
    const result = stripAttachments("hello", [IMG]);
    expect(result).toContain("hello");
    expect(result).toContain("does not support vision");
  });
});
