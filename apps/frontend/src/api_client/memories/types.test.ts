import { describe, expect, test } from "vitest";
import { FetchMemoriesResponse, MemoryType } from "./types";

/**
 * Contract guard for /api/memories. The photo objects are the same
 * `PhotoSummarySerializer` payload the album endpoints return, so this pins the
 * memory envelope around them: the kind, how far back it reaches, its span, and
 * that `numberOfItems` counts the whole memory rather than the items sent.
 */
const photo = {
  id: "a4d07b8b-da2d-4a13-8a9b-6473d3ea9edf",
  image_hash: "35088c2e6691ebabe244034adbf60cc6",
  dominantColor: "",
  url: "35088c2e6691ebabe244034adbf60cc6",
  location: "",
  date: "2025-08-24T12:00:00+00:00",
  birthTime: "2025-08-24T12:00:00Z",
  aspectRatio: 1.0,
  type: "image",
  video_length: "",
  rating: 0,
  owner: { id: 1, username: "dotan", first_name: "", last_name: "" },
  exif_gps_lat: null,
  exif_gps_lon: null,
  removed: false,
  in_trashcan: false,
  stacks: null,
  has_raw_variant: false,
};

describe("FetchMemoriesResponse", () => {
  test("parses a day memory", () => {
    const parsed = FetchMemoriesResponse.parse({
      date: "2026-08-24",
      window_days: 3,
      results: [
        {
          id: "years_ago-2025",
          type: "years_ago",
          years_ago: 1,
          year: 2025,
          date: "2025-08-24",
          start_date: "2025-08-23",
          end_date: "2025-08-25",
          location: "Rome, Italy",
          numberOfItems: 120,
          cover: photo,
          items: [photo],
        },
      ],
    });

    const [memory] = parsed.results;
    expect(memory.type).toBe(MemoryType.YEARS_AGO);
    expect(memory.years_ago).toBe(1);
    expect(memory.location).toBe("Rome, Italy");
    // The memory is bigger than the page of items it ships with.
    expect(memory.numberOfItems).toBe(120);
    expect(memory.items).toHaveLength(1);
    expect(memory.cover.image_hash).toBe(photo.image_hash);
  });

  test("parses the month fallback", () => {
    const parsed = FetchMemoriesResponse.parse({
      date: "2026-08-24",
      window_days: 3,
      results: [
        {
          id: "month_years_ago-2025",
          type: "month_years_ago",
          years_ago: 1,
          year: 2025,
          date: "2025-08-03",
          start_date: "2025-08-03",
          end_date: "2025-08-03",
          location: "",
          numberOfItems: 1,
          cover: photo,
          items: [photo],
        },
      ],
    });

    expect(parsed.results[0].type).toBe(MemoryType.MONTH_YEARS_AGO);
  });

  test("parses an empty day", () => {
    expect(FetchMemoriesResponse.parse({ date: "2026-08-24", window_days: 3, results: [] }).results).toEqual([]);
  });

  test("rejects a memory kind it does not know", () => {
    expect(() =>
      FetchMemoriesResponse.parse({
        date: "2026-08-24",
        window_days: 3,
        results: [
          {
            id: "place-1",
            type: "place",
            years_ago: 1,
            year: 2025,
            date: "2025-08-24",
            start_date: "2025-08-24",
            end_date: "2025-08-24",
            location: "",
            numberOfItems: 1,
            cover: photo,
            items: [photo],
          },
        ],
      })
    ).toThrow();
  });
});
