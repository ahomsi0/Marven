import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { loadWorkspaceExclusions, shouldExclude, isSensitivePath } from "./exclusions";

describe("index exclusions", () => {
  it("blocks common secret paths regardless of gitignore", () => {
    expect(isSensitivePath(".env.local")).toBe(true);
    expect(isSensitivePath("config/service-account-prod.json")).toBe(true);
    expect(isSensitivePath("certs/server.pem")).toBe(true);
    expect(isSensitivePath("src/index.ts")).toBe(false);
  });

  it("loads root gitignore and custom patterns", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "marven-index-ignore-"));
    await writeFile(path.join(root, ".gitignore"), "generated/\n*.secret\n", "utf8");
    const exclusions = await loadWorkspaceExclusions(root, ["vendor/"]);
    expect(shouldExclude("generated", true, exclusions)).toBe(true);
    expect(shouldExclude("src/config.secret", false, exclusions)).toBe(true);
    expect(shouldExclude("vendor", true, exclusions)).toBe(true);
    expect(shouldExclude("src/index.ts", false, exclusions)).toBe(false);
  });
});
