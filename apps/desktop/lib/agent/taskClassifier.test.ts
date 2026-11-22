import { describe, it, expect } from "vitest";
import { classifyTask } from "./taskClassifier";

describe("classifyTask", () => {
  it("classifies 'change the button color to red' as simple", () => {
    expect(classifyTask("change the button color to red")).toBe("simple");
  });

  it("classifies 'build a new authentication feature' as standard", () => {
    expect(classifyTask("build a new authentication feature")).toBe("standard");
  });

  it("classifies 'fix the typo in the header' as simple", () => {
    expect(classifyTask("fix the typo in the header")).toBe("simple");
  });

  it("classifies 'install the react-router package' as standard", () => {
    expect(classifyTask("install the react-router package")).toBe("standard");
  });

  it("classifies prompt over 120 words as standard", () => {
    const long = Array.from({ length: 121 }, () => "change").join(" ");
    expect(classifyTask(long)).toBe("standard");
  });

  it("classifies prompt with no signal words as standard", () => {
    expect(classifyTask("make it work properly")).toBe("standard");
  });

  it("classifies 'add a border to the button' as standard (add is a complexity word)", () => {
    expect(classifyTask("add a border to the button")).toBe("standard");
  });

  it("is case-insensitive", () => {
    expect(classifyTask("CHANGE the Color")).toBe("simple");
  });

  it("classifies 'update the margin' as simple", () => {
    expect(classifyTask("update the margin")).toBe("simple");
  });

  it("classifies 'refactor the color utility' as standard (refactor is a complexity word)", () => {
    expect(classifyTask("refactor the color utility")).toBe("standard");
  });

  it("does not treat 'frontend' as a signal for 'font'", () => {
    expect(classifyTask("build a frontend component")).toBe("standard");
  });

  it("does not treat 'context' as a signal for 'text'", () => {
    expect(classifyTask("fetch the context")).toBe("standard");
  });

  it("does not treat 'customize' as a signal for 'size'", () => {
    expect(classifyTask("customize the enterprise theme")).toBe("standard");
  });
});
