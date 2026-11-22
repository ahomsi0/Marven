import { describe, it, expect, vi, beforeEach } from "vitest";
import { runGit } from "./git";
import { execFile } from "child_process";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

describe("runGit", () => {
  beforeEach(() => {
    vi.mocked(execFile).mockReset();
  });

  it("returns stdout on success", async () => {
    vi.mocked(execFile).mockImplementation((cmd, args, opts, cb) => {
      (cb as any)(null, "on branch main\n", "");
      return {} as any;
    });
    const out = await runGit(["status"], "/tmp/repo");
    expect(out).toBe("on branch main");
  });

  it("returns 'not a git repository' message when git rev-parse fails", async () => {
    vi.mocked(execFile).mockImplementation((cmd, args, opts, cb) => {
      const err: any = new Error("fatal: not a git repository");
      err.code = 128;
      (cb as any)(err, "", "fatal: not a git repository");
      return {} as any;
    });
    const out = await runGit(["status"], "/tmp/notrepo");
    expect(out).toMatch(/not a git repository/i);
  });

  it("returns ENOENT message when git is not installed", async () => {
    vi.mocked(execFile).mockImplementation((cmd, args, opts, cb) => {
      const err: any = new Error("spawn git ENOENT");
      err.code = "ENOENT";
      (cb as any)(err, "", "");
      return {} as any;
    });
    const out = await runGit(["status"], "/tmp/repo");
    expect(out).toMatch(/git is not installed/i);
  });
});
