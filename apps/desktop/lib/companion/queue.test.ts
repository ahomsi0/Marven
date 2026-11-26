import { describe, it, expect } from "vitest";
import { editRequestText, takeNext, type QueuedJob } from "./queue";

describe("takeNext", () => {
  it("batches consecutive changes", () => {
    const q: QueuedJob[] = [
      { kind: "edit", request: "red background" },
      { kind: "edit", request: "bigger title" },
      { kind: "build", request: "make a quiz app", name: "quiz app" },
      { kind: "edit", request: "add a timer" },
    ];
    const first = takeNext(q)!;
    expect(first.job).toEqual({ kind: "edit", requests: ["red background", "bigger title"] });
    const second = takeNext(first.rest)!;
    expect(second.job).toEqual({ kind: "build", request: "make a quiz app", name: "quiz app" });
    expect(takeNext(second.rest)!.job).toEqual({ kind: "edit", requests: ["add a timer"] });
  });
  it("is null when empty", () => {
    expect(takeNext([])).toBeNull();
  });
});

describe("editRequestText", () => {
  it("passes one change through and numbers several", () => {
    expect(editRequestText(["red background"])).toBe("red background");
    expect(editRequestText(["red background", "bigger title"])).toBe("Make these changes:\n1. red background\n2. bigger title");
  });
});
