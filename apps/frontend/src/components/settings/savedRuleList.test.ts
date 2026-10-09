/**
 * A saved rule list keeps every entry the rule schema does not read, in its place, whatever the
 * settings page does with the rules it shows.
 */
import { describe, expect, it } from "vitest";
import { readSavedList, savedIds, withRuleOrder } from "./savedRuleList";

type Rule = { id: number; name: string };

function isRule(entry: unknown): entry is Rule {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "id" in entry &&
    typeof entry.id === "number" &&
    "name" in entry &&
    typeof entry.name === "string"
  );
}

const a: Rule = { id: 1, name: "a" };
const b: Rule = { id: 2, name: "b" };
const c: Rule = { id: 3, name: "c" };
const unknownRule = { id: 9, rule_type: "added_later" };

describe("readSavedList", () => {
  it("reads a list, or the JSON string of one", () => {
    expect(readSavedList([a, "x"])).toEqual([a, "x"]);
    expect(readSavedList(JSON.stringify([a, null]))).toEqual([a, null]);
  });

  it("reads anything else as an empty list", () => {
    expect(readSavedList("[{")).toEqual([]);
    expect(readSavedList(JSON.stringify({ id: 1 }))).toEqual([]);
    expect(readSavedList(null)).toEqual([]);
    expect(readSavedList(undefined)).toEqual([]);
  });
});

describe("savedIds", () => {
  it("has the id of every entry that has one, a rule or not", () => {
    expect(savedIds([a, unknownRule, "x", null, { name: "no id" }])).toEqual([1, 9]);
  });
});

describe("withRuleOrder", () => {
  it("puts the rules in the new order and leaves every other entry in its place", () => {
    const entries = [unknownRule, a, "x", b, c, null];

    expect(withRuleOrder(entries, isRule, [c, a, b])).toEqual([unknownRule, c, "x", a, b, null]);
  });

  it("keeps the entries unchanged for the same order", () => {
    const entries = [a, unknownRule, b];

    expect(withRuleOrder(entries, isRule, [a, b])).toEqual(entries);
  });
});
