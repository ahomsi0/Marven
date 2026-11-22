import { describe, it, expect } from "vitest";
import { absolutePathToFileUrl } from "./fileUrl";

describe("absolutePathToFileUrl", () => {
  it("encodes posix paths", () => {
    expect(absolutePathToFileUrl("/tmp/a b.ts")).toMatch(/^file:\/\/\/tmp\/a%20b\.ts$/);
  });

  it("handles Windows-style drive paths", () => {
    expect(absolutePathToFileUrl("C:\\Users\\x\\y.ts")).toBe("file:///C:/Users/x/y.ts");
  });
});
