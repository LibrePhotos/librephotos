import { describe, expect, test } from "vitest";
import { Tag, TagAlbumResponse, TagListResponse } from "./types";

const envelope = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results });

const tagRow = {
  id: 7,
  name: "beach",
  photo_count: 2,
  cover_photos: [
    { image_hash: "a".repeat(32), video: false },
    { image_hash: "b".repeat(32), video: true },
  ],
};

describe("tag schemas", () => {
  test("the tag list accepts the paginated envelope the viewset returns", () => {
    const parsed = TagListResponse.parse(envelope([tagRow]));

    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].name).toBe("beach");
    expect(parsed.results[0].cover_photos).toHaveLength(2);
  });

  test("a tag without photos still parses", () => {
    const parsed = TagListResponse.parse(envelope([{ id: 8, name: "empty", photo_count: 0, cover_photos: [] }]));

    expect(parsed.results[0].photo_count).toBe(0);
    expect(parsed.results[0].cover_photos).toEqual([]);
  });

  test("the create response parses into a Tag with its new id", () => {
    const parsed = Tag.parse({ id: 9, name: "sunset", photo_count: 0 });

    expect(parsed.id).toBe(9);
  });

  test("a tag id that arrives as a string is rejected rather than silently coerced", () => {
    // The lightbox editor feeds the id straight back into /tags/<id>/add/, so a
    // string id has to surface as a parse error instead of a bad request.
    const result = Tag.safeParse({ id: "9", name: "sunset", photo_count: 0 });

    expect(result.success).toBe(false);
  });

  test("the tag detail response keeps the grouped photo shape", () => {
    const parsed = TagAlbumResponse.parse({
      results: {
        id: 7,
        name: "beach",
        grouped_photos: [
          {
            date: "2023-05-01",
            location: "Lisbon",
            items: [
              {
                id: "123e4567-e89b-12d3-a456-426614174000",
                image_hash: "c".repeat(32),
                aspectRatio: 1.5,
              },
            ],
          },
        ],
      },
    });

    expect(parsed.results.grouped_photos[0].items).toHaveLength(1);
  });
});
