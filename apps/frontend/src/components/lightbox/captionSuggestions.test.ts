import { describe, expect, it } from "vitest";
import { hashtagAtCaret, hashtagSuggestions, insertHashtag } from "./captionSuggestions";

describe("hashtagAtCaret", () => {
  it("finds the hashtag being typed, from its # to the end of its word", () => {
    expect(hashtagAtCaret("Sunset at the #bea", 18)).toEqual({ start: 14, end: 18, query: "bea" });
    expect(hashtagAtCaret("#beach today", 3)).toEqual({ start: 0, end: 6, query: "be" });
    expect(hashtagAtCaret("a #", 3)).toEqual({ start: 2, end: 3, query: "" });
  });

  it("needs the # at the start or after a space, as tiptap's suggestion did", () => {
    expect(hashtagAtCaret("issue#12", 8)).toBeNull();
    expect(hashtagAtCaret("line one\n#tag", 13)).toEqual({ start: 9, end: 13, query: "tag" });
  });

  it("ends at a space after the hashtag", () => {
    expect(hashtagAtCaret("#beach ", 7)).toBeNull();
    expect(hashtagAtCaret("plain text", 5)).toBeNull();
  });
});

describe("hashtagSuggestions", () => {
  it("offers up to five matching hashtags and what was typed as a new one, typed first", () => {
    const hashtags = ["beach", "bear", "bee", "best", "berry", "bed", "city"];
    expect(hashtagSuggestions(hashtags, "be")).toEqual(["be", "berry", "best", "bee", "bear", "beach"]);
  });

  it("reads the hashtag albums' titles, which keep their #, as words", () => {
    expect(hashtagSuggestions(["#sunset", "#hike", "sunset"], "s")).toEqual(["s", "sunset"]);
  });

  it("does not offer an empty hashtag or a second copy of an existing one", () => {
    expect(hashtagSuggestions(["beach"], "")).toEqual(["beach"]);
    expect(hashtagSuggestions(["beach"], "beach")).toEqual(["beach"]);
    expect(hashtagSuggestions([], "")).toEqual([]);
  });
});

describe("insertHashtag", () => {
  it("replaces the hashtag being typed and puts the caret after it and a space", () => {
    const text = "Sunset at the #be";
    expect(insertHashtag(text, { start: 14, end: 17, query: "be" }, "beach")).toEqual({
      text: "Sunset at the #beach ",
      caret: 21,
    });
  });

  it("replaces the rest of the word and does not double the space after it", () => {
    expect(insertHashtag("#bxch today", { start: 0, end: 5, query: "b" }, "beach")).toEqual({
      text: "#beach today",
      caret: 7,
    });
  });
});
