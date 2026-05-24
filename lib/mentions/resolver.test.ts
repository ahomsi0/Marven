import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { resolveMentions } from "./resolver";

vi.mock("@/lib/index/search", () => ({
  searchCodebase: vi.fn(),
}));

import { searchCodebase } from "@/lib/index/search";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mentions-resolver-"));
  vi.mocked(searchCodebase).mockReset();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("resolveMentions — file", () => {
  it("returns full content for small files wrapped in a code fence", async () => {
    await fs.writeFile(path.join(tmpRoot, "hello.ts"), "export const x = 1;\n");
    const [r] = await resolveMentions([{ kind: "file", path: "hello.ts" }], {
      workspaceRoot: tmpRoot,
    });
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.body).toContain("### File: hello.ts");
    expect(r.body).toContain("```typescript");
    expect(r.body).toContain("export const x = 1;");
  });

  it("truncates large files with head+tail joined by marker", async () => {
    const big = "A".repeat(40 * 1024) + "BBBB" + "C".repeat(8 * 1024);
    await fs.writeFile(path.join(tmpRoot, "big.txt"), big);
    const [r] = await resolveMentions([{ kind: "file", path: "big.txt" }], {
      workspaceRoot: tmpRoot,
    });
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.body).toContain("[…truncated…]");
    // ends with C-block from the tail
    expect(r.body).toContain("C".repeat(100));
  });

  it("returns ok=false when the file is missing", async () => {
    const [r] = await resolveMentions([{ kind: "file", path: "missing.ts" }], {
      workspaceRoot: tmpRoot,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe("resolveMentions — folder", () => {
  it("lists files with previews; skips binaries", async () => {
    const dir = path.join(tmpRoot, "pkg");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "a.ts"), "line1\nline2\nline3\n");
    await fs.writeFile(path.join(dir, "b.md"), "# header\n");
    // binary: contains NUL byte
    await fs.writeFile(path.join(dir, "blob.bin"), Buffer.from([0, 1, 2, 3, 0, 0, 0, 0]));
    const [r] = await resolveMentions([{ kind: "folder", path: "pkg" }], {
      workspaceRoot: tmpRoot,
    });
    expect(r.ok).toBe(true);
    expect(r.body).toContain("### Folder: pkg");
    expect(r.body).toContain("- a.ts");
    expect(r.body).toContain("line1");
    expect(r.body).toContain("- b.md");
    expect(r.body).toContain("blob.bin");
    expect(r.body).toContain("(binary, skipped)");
  });

  it("marks remaining files as not-previewed when folder budget reached", async () => {
    const dir = path.join(tmpRoot, "big");
    await fs.mkdir(dir);
    const fat = "X".repeat(10 * 1024);
    await fs.writeFile(path.join(dir, "a.txt"), fat);
    await fs.writeFile(path.join(dir, "b.txt"), fat);
    await fs.writeFile(path.join(dir, "c.txt"), fat);
    const [r] = await resolveMentions([{ kind: "folder", path: "big" }], {
      workspaceRoot: tmpRoot,
    });
    expect(r.ok).toBe(true);
    expect(r.body).toContain("not previewed — folder budget reached");
  });
});

describe("resolveMentions — codebase", () => {
  it("formats top-K search results", async () => {
    vi.mocked(searchCodebase).mockResolvedValue([
      { path: "src/a.ts", startLine: 1, endLine: 5, text: "function a() {}", distance: 0.21 },
      { path: "src/b.ts", startLine: 10, endLine: 12, text: "function b() {}", distance: 0.33 },
    ]);
    const [r] = await resolveMentions(
      [{ kind: "codebase", query: "foo" }],
      { workspaceRoot: tmpRoot },
    );
    expect(r.ok).toBe(true);
    expect(r.body).toContain(`### Codebase search: "foo"`);
    expect(r.body).toContain("[1] src/a.ts:1-5");
    expect(r.body).toContain("function a()");
    expect(r.body).toContain("[2] src/b.ts:10-12");
  });

  it("returns ok=false for empty query", async () => {
    const [r] = await resolveMentions(
      [{ kind: "codebase", query: "   " }],
      { workspaceRoot: tmpRoot },
    );
    expect(r.ok).toBe(false);
    expect(searchCodebase).not.toHaveBeenCalled();
  });
});

describe("resolveMentions — web", () => {
  it("strips HTML and returns text", async () => {
    const html = "<html><head><style>x</style></head><body><p>Hello <b>world</b></p><script>bad</script></body></html>";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    );
    const [r] = await resolveMentions(
      [{ kind: "web", url: "https://example.com/" }],
      { workspaceRoot: tmpRoot },
    );
    expect(r.ok).toBe(true);
    expect(r.body).toContain("### Web: https://example.com/");
    expect(r.body).toContain("Hello world");
    expect(r.body).not.toContain("<");
    fetchSpy.mockRestore();
  });

  it("rejects invalid URLs", async () => {
    const [r] = await resolveMentions(
      [{ kind: "web", url: "not-a-url" }],
      { workspaceRoot: tmpRoot },
    );
    expect(r.ok).toBe(false);
  });
});

describe("resolveMentions — budget enforcement", () => {
  it("proportionally truncates oversize bodies across multiple mentions", async () => {
    // Create three files totaling about 60KB after wrapping.
    const big = "Y".repeat(20 * 1024);
    await fs.writeFile(path.join(tmpRoot, "a.txt"), big);
    await fs.writeFile(path.join(tmpRoot, "b.txt"), big);
    await fs.writeFile(path.join(tmpRoot, "c.txt"), big);
    const resolved = await resolveMentions(
      [
        { kind: "file", path: "a.txt" },
        { kind: "file", path: "b.txt" },
        { kind: "file", path: "c.txt" },
      ],
      { workspaceRoot: tmpRoot, totalBudgetChars: 30_000 },
    );
    const total = resolved.reduce((s, r) => s + r.body.length, 0);
    expect(total).toBeLessThanOrEqual(30_000);
    for (const r of resolved) {
      expect(r.truncated).toBe(true);
      expect(r.body).toContain("truncated to fit context budget");
    }
  });
});
