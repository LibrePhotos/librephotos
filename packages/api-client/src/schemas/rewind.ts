import { z } from "zod";
import { PigPhoto } from "./common";

/** A named person of a Rewind: on how many of the year's photos, and their cover face's crop. */
export const RewindPerson = z.object({
  id: z.number(),
  name: z.string(),
  photo_count: z.number(),
  face_url: z.string().nullable(),
});
export type RewindPerson = z.infer<typeof RewindPerson>;

/** The day of the year with the most photos and videos. */
export const RewindDay = z.object({
  date: z.string(),
  count: z.number(),
});
export type RewindDay = z.infer<typeof RewindDay>;

export const RewindPlace = z.object({
  name: z.string(),
  photo_count: z.number(),
});
export type RewindPlace = z.infer<typeof RewindPlace>;

/**
 * `GET /rewind/?year=`: the user's year in photos (api/dataviz/rewind.py). Only their own photos, as
 * the timeline shows them, without screenshots and documents.
 */
export const Rewind = z.object({
  year: z.number(),
  photo_count: z.number(),
  video_count: z.number(),
  // Photos and videos per month, January first.
  months: z.number().array(),
  busiest_day: RewindDay.nullable(),
  busiest_day_photos: PigPhoto.array(),
  cover_photos: PigPhoto.array(),
  people: RewindPerson.array(),
  place_count: z.number(),
  country_count: z.number(),
  top_places: RewindPlace.array(),
});
export type Rewind = z.infer<typeof Rewind>;
