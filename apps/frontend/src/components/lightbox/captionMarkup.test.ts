import { describe, expect, it } from "vitest";
import { captionParts, captionToEditorHtml } from "./captionMarkup";

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

  it("collapses line breaks and runs of spaces into one, as the editor's HTML parse did", () => {
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

describe("captionToEditorHtml", () => {
  it("turns each hashtag into a mention for the editor", () => {
    expect(captionToEditorHtml("At the #beach")).toBe('At the <span data-type="mention" data-id=beach>#beach</span>');
  });
});
