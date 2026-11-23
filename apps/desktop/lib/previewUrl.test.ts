import { describe, expect, it } from "vitest";
import { decodePreviewRoot, encodePreviewRoot, workspacePreviewUrl } from "./previewUrl";

describe("previewUrl", () => {
  const root = "/Users/me/Personal Projects/MARVEN CODING TEST/Live test webs";

  it("round-trips roots with spaces and non-ASCII characters", () => {
    for (const r of [root, "C:\\Users\\me\\site", "/tmp/سايت/ünï"]) {
      expect(decodePreviewRoot(encodePreviewRoot(r))).toBe(r);
    }
  });

  it("encodes to a single URL-safe path segment", () => {
    expect(encodePreviewRoot(root)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns null for segments that aren't a valid encoding", () => {
    expect(decodePreviewRoot("")).toBeNull();
    expect(decodePreviewRoot("not base64 !")).toBeNull();
  });

  it("builds a URL whose relative links stay inside the same root", () => {
    const url = workspacePreviewUrl(root, "pages/index.html");
    const asset = new URL("../css/style.css", `http://app${url}`);
    expect(asset.pathname).toBe(`/api/workspace/preview/@${encodePreviewRoot(root)}/css/style.css`);
  });

  it("encodes each path segment of the file", () => {
    expect(workspacePreviewUrl(root, "my pages/a#b.html")).toBe(
      `/api/workspace/preview/@${encodePreviewRoot(root)}/my%20pages/a%23b.html`,
    );
  });
});
