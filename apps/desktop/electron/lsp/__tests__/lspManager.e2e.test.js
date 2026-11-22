import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const ENABLED = process.env.RUN_LSP_E2E === "1";
const d = ENABLED ? describe : describe.skip;

d("LspManager e2e against real typescript-language-server", () => {
  it("publishes a diagnostic for a type error within 10s", { timeout: 60000 }, async () => {
    const { LspManager } = require("../lspManager");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "marven-lsp-e2e-"));
    const file = path.join(tmp, "foo.ts");
    fs.writeFileSync(file, 'const x: number = "wrong";\n', "utf8");
    fs.writeFileSync(
      path.join(tmp, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, target: "es2020", module: "esnext" } }),
    );

    const mgr = new LspManager();
    const ensured = await mgr.ensure("typescript");
    expect(ensured.status).toBe("ready");

    const diags = [];
    mgr.on("notification", (n) => {
      if (n.method === "textDocument/publishDiagnostics") diags.push(n.params);
    });

    const { sessionId } = await mgr.openSession({
      languageId: "typescript",
      filePath: file,
      workspaceRoot: tmp,
      text: fs.readFileSync(file, "utf8"),
    });

    const start = Date.now();
    while (Date.now() - start < 10000) {
      const match = diags.find((d) => d.uri.endsWith("/foo.ts") && d.diagnostics.some((x) => /assignable/.test(x.message)));
      if (match) {
        await mgr.closeSession(sessionId);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    await mgr.closeSession(sessionId);
    throw new Error("no diagnostic received in 10s; got: " + JSON.stringify(diags, null, 2));
  });
});
