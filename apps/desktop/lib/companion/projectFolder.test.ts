import { describe, expect, it } from "vitest";
import path from "path";
import { expandHome, isStrictlyInside, parentRejection, pickUniqueName, projectSlug } from "./projectFolder";

describe("projectSlug", () => {
  it("lowercases and joins words with dashes", () => {
    expect(projectSlug("Cafe Menu")).toBe("cafe-menu");
  });
  it("drops punctuation, accents and collapses dashes", () => {
    expect(projectSlug("  Café --  menu!! v2 ")).toBe("cafe-menu-v2");
  });
  it("caps at 40 characters without a trailing dash", () => {
    const slug = projectSlug("a ".repeat(60));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
    expect(projectSlug("abcdefghi ".repeat(6)).endsWith("-")).toBe(false);
  });
  it("falls back to project", () => {
    expect(projectSlug("")).toBe("project");
    expect(projectSlug("!!!")).toBe("project");
    expect(projectSlug("متجر")).toBe("project");
  });
  it("avoids Windows reserved device names", () => {
    for (const n of ["con", "PRN", "aux", "nul", "com1", "COM9", "lpt1", "lpt9"]) {
      expect(projectSlug(n), n).toBe(`${n.toLowerCase()}-project`);
    }
    expect(projectSlug("console")).toBe("console");
    expect(projectSlug("com10")).toBe("com10");
  });
  it("only ever produces [a-z0-9-]", () => {
    expect(projectSlug("../../etc/passwd")).toMatch(/^[a-z0-9-]+$/);
    expect(projectSlug("../../etc/passwd")).toBe("etc-passwd");
  });
});

describe("pickUniqueName", () => {
  it("keeps the name when free", () => {
    expect(pickUniqueName("cafe-menu", [])).toBe("cafe-menu");
  });
  it("appends -2, -3 when taken", () => {
    expect(pickUniqueName("cafe-menu", ["cafe-menu"])).toBe("cafe-menu-2");
    expect(pickUniqueName("cafe-menu", ["cafe-menu", "cafe-menu-2"])).toBe("cafe-menu-3");
  });
  it("compares case-insensitively", () => {
    expect(pickUniqueName("cafe-menu", ["Cafe-Menu"])).toBe("cafe-menu-2");
  });
  it("keeps the suffixed name within 40 characters", () => {
    const base = "a".repeat(40);
    const picked = pickUniqueName(base, [base]);
    expect(picked.length).toBeLessThanOrEqual(40);
    expect(picked.endsWith("-2")).toBe(true);
  });
});

describe("expandHome", () => {
  it("expands ~ and ~/", () => {
    expect(expandHome("~", "/Users/me")).toBe("/Users/me");
    expect(expandHome("~/Marven Projects", "/Users/me")).toBe(path.join("/Users/me", "Marven Projects"));
  });
  it("leaves other paths alone and rejects ~user", () => {
    expect(expandHome("/tmp/x", "/Users/me")).toBe("/tmp/x");
    expect(expandHome("~other/x", "/Users/me")).toBe("~other/x");
  });
});

describe("isStrictlyInside", () => {
  it("accepts descendants only", () => {
    expect(isStrictlyInside("/Users/me/Marven Projects", "/Users/me")).toBe(true);
    expect(isStrictlyInside("/Users/me", "/Users/me")).toBe(false);
  });
  it("rejects siblings with a shared prefix and escapes", () => {
    expect(isStrictlyInside("/Users/me2/x", "/Users/me")).toBe(false);
    expect(isStrictlyInside("/Users/me/../other", "/Users/me")).toBe(false);
    expect(isStrictlyInside("/etc", "/Users/me")).toBe(false);
  });
  it("rejects relative paths", () => {
    expect(isStrictlyInside("Marven Projects", "/Users/me")).toBe(false);
  });
});

describe("parentRejection", () => {
  const home = "/Users/me";
  it("accepts ordinary folders under home", () => {
    expect(parentRejection("/Users/me/Marven Projects", home)).toBeNull();
    expect(parentRejection("/Users/me/Documents/Code/projects", home)).toBeNull();
  });
  it("rejects hidden segments under home", () => {
    expect(parentRejection("/Users/me/.ssh", home)).toMatch(/hidden/i);
    expect(parentRejection("/Users/me/Work/.config/x", home)).toMatch(/hidden/i);
  });
  it("rejects ~/Library", () => {
    expect(parentRejection("/Users/me/Library", home)).toMatch(/Library/);
    expect(parentRejection("/Users/me/library/Application Support", home)).toMatch(/Library/);
  });
  it("rejects paths outside home", () => {
    expect(parentRejection("/etc", home)).toMatch(/home/i);
    expect(parentRejection("/Users/me", home)).toMatch(/home/i);
  });
});
