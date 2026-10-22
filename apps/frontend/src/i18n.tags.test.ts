// @vitest-environment node
/**
 * src/locales/en/tags.json is the Weblate source of the things' names (#2744): one key per word of
 * the tagger's list, apps/backend/service/tags/tags.txt, with the word itself as the English name.
 * A word added to tags.txt and forgotten here would never be translated, so the two must match.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import tagsEn from "./locales/en/tags.json";

// `yarn test` runs from apps/frontend.
const TAGS_TXT = resolve("..", "backend", "service", "tags", "tags.txt");

/** The words as the tags sidecar reads them (openclip.read_tag_file): trimmed, no blank or # lines. */
function readTagFile(path: string): string[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "" && !line.startsWith("#"));
}

describe("tags.json", () => {
  it("lists every word of tags.txt, in its order, named as itself", () => {
    expect(Object.keys(tagsEn)).toEqual(readTagFile(TAGS_TXT));
    expect(Object.entries(tagsEn).filter(([key, name]) => key !== name)).toEqual([]);
  });

  it("has no key a hashtag album could match", () => {
    // Hashtag albums are titled "#word" and show as they are
    expect(Object.keys(tagsEn).filter(key => key.startsWith("#"))).toEqual([]);
  });
});
