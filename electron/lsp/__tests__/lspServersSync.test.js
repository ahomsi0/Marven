// Note: vitest must be ESM-imported (require fails per vitest 4.x).
import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { LSP_SERVERS: mainServers } = require("../lspServers");

describe("electron/lsp/lspServers.js", () => {
  it("exports a typescript spec with required fields", () => {
    const ts = mainServers.typescript;
    expect(ts).toBeDefined();
    expect(ts.languageId).toBe("typescript");
    expect(ts.command).toBe("typescript-language-server");
    expect(ts.args).toEqual(["--stdio"]);
    expect(Array.isArray(ts.npmPackages)).toBe(true);
    expect(ts.npmPackages).toContain("typescript-language-server");
    expect(ts.extensions).toEqual(
      expect.arrayContaining(["ts", "tsx", "js", "jsx", "mjs", "cjs"])
    );
  });

  it("matches the renderer registry shape", async () => {
    // Renderer module is TS; import via vitest's TS transform.
    const renderer = await import("../../../lib/editor/lspServers");
    expect(Object.keys(mainServers).sort()).toEqual(
      Object.keys(renderer.LSP_SERVERS).sort()
    );
    for (const id of Object.keys(mainServers)) {
      const m = mainServers[id];
      const r = renderer.LSP_SERVERS[id];
      expect(m.command).toBe(r.command);
      expect(m.args).toEqual(r.args);
      expect(m.npmPackages).toEqual(r.npmPackages);
      expect(m.extensions.sort()).toEqual([...r.extensions].sort());
    }
  });
});
