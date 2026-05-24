import { describe, it, expect } from "vitest";
import { LSP_SERVERS, languageIdForExtension } from "./lspServers";

describe("lspServers registry", () => {
  it("registers typescript with the expected npm packages and command", () => {
    const ts = LSP_SERVERS.typescript;
    expect(ts.languageId).toBe("typescript");
    expect(ts.npmPackages).toEqual(["typescript", "typescript-language-server"]);
    expect(ts.command).toBe("typescript-language-server");
    expect(ts.args).toEqual(["--stdio"]);
    expect(ts.extensions).toEqual(
      expect.arrayContaining(["ts", "tsx", "js", "jsx", "mjs", "cjs"])
    );
  });

  it("languageIdForExtension maps known extensions to typescript", () => {
    expect(languageIdForExtension("ts")).toBe("typescript");
    expect(languageIdForExtension("tsx")).toBe("typescript");
    expect(languageIdForExtension("jsx")).toBe("typescript");
    expect(languageIdForExtension("mjs")).toBe("typescript");
  });

  it("languageIdForExtension is case-insensitive", () => {
    expect(languageIdForExtension("TS")).toBe("typescript");
    expect(languageIdForExtension("TSX")).toBe("typescript");
  });

  it("languageIdForExtension returns null for unsupported extensions", () => {
    expect(languageIdForExtension("py")).toBeNull();
    expect(languageIdForExtension("rs")).toBeNull();
    expect(languageIdForExtension("")).toBeNull();
  });
});
