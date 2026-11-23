import { describe, expect, it } from "vitest";
import { captionParts, hashtagRuns } from "./captionMarkup";

describe("captionParts", () => {
  it("splits a caption into text and hashtags, each keyed by where it starts", () => {
    expect(captionParts("Sunset at the #beach with #friends!")).toEqual([
      { text: "Sunset at the ", hashtag: false, start: 0 },
      { text: "#beach", hashtag: true, start: 14 },
      { text: " with ", hashtag: false, start: 20 },
      { text: "#friends", hashtag: true, start: 26 },
      { text: "!", hashtag: false, start: 34 },
    ]);
  });

  it("collapses line breaks and runs of spaces into one, as the caption has always been shown", () => {
    expect(captionParts("  Two\n\nparagraphs   here  ").map(part => part.text)).toEqual(["Two paragraphs here"]);
  });

  it("keeps hashtags side by side, and a bare # as text", () => {
    expect(captionParts("#a#b # c").map(part => [part.text, part.hashtag])).toEqual([
      ["#a", true],
      ["#b", true],
      [" # c", false],
    ]);
  });

  it("is empty for an empty caption", () => {
    expect(captionParts("")).toEqual([]);
  });
});

describe("hashtagRuns", () => {
  it("keeps the text as typed, line breaks and spaces included, for the editor's highlight", () => {
    expect(hashtagRuns("Day one\n\n  at the #beach ")).toEqual([
      { text: "Day one\n\n  at the ", hashtag: false, start: 0 },
      { text: "#beach", hashtag: true, start: 18 },
      { text: " ", hashtag: false, start: 24 },
    ]);
  });
});
