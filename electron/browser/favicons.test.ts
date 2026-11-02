import { describe, it, expect } from "vitest";
import { readCapped, imageType, resolveType } from "./favicons.js";

function streamOf(chunks: Uint8Array[]) {
  let cancelled = false;
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  return { body, wasCancelled: () => cancelled, pulled: () => i };
}

const response = (body: ReadableStream<Uint8Array> | null, headers: Record<string, string> = {}) =>
  ({ headers: new Headers(headers), body });

describe("readCapped", () => {
  it("reads a small body", async () => {
    const { body } = streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]);
    const bytes = await readCapped(response(body), 10);
    expect(bytes && [...bytes]).toEqual([1, 2, 3]);
  });

  it("refuses up front when content-length is over the cap", async () => {
    const s = streamOf([new Uint8Array(5)]);
    expect(await readCapped(response(s.body, { "content-length": "11" }), 10)).toBeNull();
    expect(s.pulled()).toBe(0);
  });

  it("stops reading and cancels once the body passes the cap", async () => {
    const s = streamOf([new Uint8Array(6), new Uint8Array(6), new Uint8Array(6)]);
    expect(await readCapped(response(s.body), 10)).toBeNull();
    expect(s.wasCancelled()).toBe(true);
    expect(s.pulled()).toBeLessThan(3);
  });

  it("accepts a body of exactly the cap", async () => {
    const { body } = streamOf([new Uint8Array(10)]);
    expect((await readCapped(response(body), 10))?.length).toBe(10);
  });

  it("returns null for an empty or missing body", async () => {
    expect(await readCapped(response(streamOf([]).body), 10)).toBeNull();
    expect(await readCapped(response(null), 10)).toBeNull();
  });
});

describe("imageType", () => {
  it("accepts raster image types, ignoring parameters and case", () => {
    expect(imageType("image/PNG; charset=binary")).toBe("image/png");
    expect(imageType("image/x-icon")).toBe("image/x-icon");
    expect(imageType("image/webp")).toBe("image/webp");
  });

  it("accepts ICO, GIF and SVG types", () => {
    expect(imageType("image/vnd.microsoft.icon")).toBe("image/vnd.microsoft.icon");
    expect(imageType("image/gif")).toBe("image/gif");
    expect(imageType("image/jpeg")).toBe("image/jpeg");
    expect(imageType("image/svg+xml; charset=utf-8")).toBe("image/svg+xml");
  });

  it("rejects non-images", () => {
    expect(imageType("text/html")).toBeNull();
    expect(imageType("application/octet-stream")).toBeNull();
    expect(imageType("image/tiff")).toBeNull();
    expect(imageType(null)).toBeNull();
  });
});

describe("resolveType", () => {
  const ico = new Uint8Array([0, 0, 1, 0, 1, 0]);

  it("uses the declared type when it is accepted", () => {
    expect(resolveType("image/png", "https://a.test/icon", new Uint8Array([1]))).toBe("image/png");
  });

  it("treats a .ico URL with ICO magic bytes as image/x-icon when the type is missing or generic", () => {
    expect(resolveType("application/octet-stream", "https://a.test/favicon.ico", ico)).toBe("image/x-icon");
    expect(resolveType(null, "https://a.test/favicon.ICO?v=2", ico)).toBe("image/x-icon");
  });

  it("does not sniff when the URL is not .ico or the bytes are not an ICO", () => {
    expect(resolveType(null, "https://a.test/favicon.png", ico)).toBeNull();
    expect(resolveType(null, "https://a.test/favicon.ico", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(resolveType("text/html", "https://a.test/favicon.ico", new Uint8Array([0, 0]))).toBeNull();
  });

  it("does not sniff a non-image type that is not .ico", () => {
    expect(resolveType("text/html", "not a url", ico)).toBeNull();
  });
});
