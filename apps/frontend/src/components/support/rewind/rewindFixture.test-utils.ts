import type { Rewind } from "@librephotos/api-client";

/** A full year: people, places and a busiest month (August). */
export function testRewind(overrides: Partial<Rewind> = {}): Rewind {
  return {
    year: 2026,
    photo_count: 4000,
    video_count: 118,
    months: [90, 40, 80, 120, 160, 190, 260, 986, 170, 120, 70, 140],
    busiest_day: { date: "2026-08-14", count: 212 },
    busiest_day_photos: [],
    cover_photos: [],
    people: [{ id: 1, name: "Mia", photo_count: 812, face_url: null }],
    place_count: 112,
    country_count: 6,
    top_places: [{ name: "Lisbon", photo_count: 340 }],
    ...overrides,
  };
}
