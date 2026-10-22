/** The client's check of a name pattern follows the server's (`api/photos/naming.py`, #2773). */
import { describe, expect, it } from "vitest";
import { insertToken, NAME_PRESETS, namePatternProblem, presetOf } from "./namePatterns";

describe("namePatternProblem", () => {
  it("passes the presets and plain text", () => {
    for (const pattern of [...Object.values(NAME_PRESETS), "holiday {year}"]) {
      expect(namePatternProblem(pattern)).toBeNull();
    }
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["x".repeat(201), "toolong"],
    ["{nope}", "unknowntoken"],
    ["{year", "unknowntoken"],
    ["../x", "unsafe"],
    ["a/b", "unsafe"],
    ["con:", "unsafe"],
    [".hidden", "unsafe"],
    ["tab\there", "unsafe"],
  ])("refuses %j as %s", (pattern, problem) => {
    expect(namePatternProblem(pattern)).toBe(problem);
  });
});

describe("presetOf", () => {
  it("names a preset and calls anything else custom", () => {
    expect(presetOf(NAME_PRESETS.datename)).toBe("datename");
    expect(presetOf("{year}")).toBe("custom");
  });
});

describe("insertToken", () => {
  it("replaces the selection and puts the caret after the token", () => {
    expect(insertToken("ab", "{day}", 1, 2)).toEqual(["a{day}", 6]);
  });
});
