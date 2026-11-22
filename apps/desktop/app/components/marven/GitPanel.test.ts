import { describe, it, expect } from "vitest";
import { parsePorcelain } from "@/lib/gitUtils";

describe("parsePorcelain", () => {
  it("parses a staged modified file (M in index)", () => {
    const { staged, unstaged, untracked } = parsePorcelain("M  src/foo.ts\n");
    expect(staged).toEqual([{ path: "src/foo.ts", statusCode: "M" }]);
    expect(unstaged).toHaveLength(0);
    expect(untracked).toHaveLength(0);
  });

  it("parses an unstaged modified file (M in worktree)", () => {
    const { staged, unstaged, untracked } = parsePorcelain(" M src/baz.ts\n");
    expect(staged).toHaveLength(0);
    expect(unstaged).toEqual([{ path: "src/baz.ts", statusCode: "M" }]);
    expect(untracked).toHaveLength(0);
  });

  it("parses an untracked file (??)", () => {
    const { staged, unstaged, untracked } = parsePorcelain("?? new-file.ts\n");
    expect(staged).toHaveLength(0);
    expect(unstaged).toHaveLength(0);
    expect(untracked).toEqual([{ path: "new-file.ts", statusCode: "?" }]);
  });

  it("parses a renamed file (R in index)", () => {
    const { staged, unstaged, untracked } = parsePorcelain("R  new-name.ts -> old-name.ts\n");
    // takes the left side of " -> "
    expect(staged).toEqual([{ path: "new-name.ts", statusCode: "R" }]);
    expect(unstaged).toHaveLength(0);
    expect(untracked).toHaveLength(0);
  });

  it("parses a file that is both staged AND unstaged (MM)", () => {
    const { staged, unstaged, untracked } = parsePorcelain("MM src/both.ts\n");
    expect(staged).toEqual([{ path: "src/both.ts", statusCode: "M" }]);
    expect(unstaged).toEqual([{ path: "src/both.ts", statusCode: "M" }]);
    expect(untracked).toHaveLength(0);
  });

  it("parses a staged new file (A in index)", () => {
    const { staged, unstaged, untracked } = parsePorcelain("A  src/bar.ts\n");
    expect(staged).toEqual([{ path: "src/bar.ts", statusCode: "A" }]);
    expect(unstaged).toHaveLength(0);
    expect(untracked).toHaveLength(0);
  });

  it("parses multiple lines at once", () => {
    const input = "M  src/foo.ts\n M src/baz.ts\n?? new.ts\n";
    const { staged, unstaged, untracked } = parsePorcelain(input);
    expect(staged).toHaveLength(1);
    expect(unstaged).toHaveLength(1);
    expect(untracked).toHaveLength(1);
  });

  it("ignores empty lines", () => {
    const { staged, unstaged, untracked } = parsePorcelain("\n\n");
    expect(staged).toHaveLength(0);
    expect(unstaged).toHaveLength(0);
    expect(untracked).toHaveLength(0);
  });
});
