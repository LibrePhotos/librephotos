import { z } from "zod";
import { PigPhoto } from "../photos/types";

/**
 * What a memory is about. Only date-based memories exist so far; the backend
 * sends the kind so that place- or person-based ones can be added later without
 * the frontend having to guess.
 */
export enum MemoryType {
  YEARS_AGO = "years_ago",
  MONTH_YEARS_AGO = "month_years_ago",
}

/**
 * The most photos per memory the backend will return (its
 * MAX_ITEMS_PER_MEMORY). The gallery and the all-memories slideshow ask for
 * this; a memory bigger than it says so through `numberOfItems`.
 */
export const MAX_MEMORY_ITEMS = 200;

export const Memory = z.object({
  id: z.string(),
  type: z.nativeEnum(MemoryType),
  years_ago: z.number(),
  year: z.number(),
  // The day worth naming, and the span the memory actually covers.
  date: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  location: z.string().default(""),
  // The full size of the memory; `items` is capped by the backend.
  numberOfItems: z.number(),
  cover: PigPhoto,
  items: PigPhoto.array(),
});
export type Memory = z.infer<typeof Memory>;

export const FetchMemoriesResponse = z.object({
  date: z.string(),
  window_days: z.number(),
  results: Memory.array(),
});
export type FetchMemoriesResponse = z.infer<typeof FetchMemoriesResponse>;
