import { z } from "zod";
import { PigPhoto } from "../photos/types";

export const SearchExamples = z.array(z.string());
export const SearchExamplesResponse = z.object({
  results: SearchExamples,
});
export type SearchExamples = z.infer<typeof SearchExamples>;

export const PhotosGroupedByDate = z.array(
  z.object({
    // The undated group's date: null from the album, person, place, thing and
    // tag lists; search, and those lists on servers before 1.3, send the legacy
    // "No timestamp" string. Accept both, so search can switch too.
    date: z.string().nullable(),
    location: z.string(),
    items: z.array(PigPhoto),
  })
);

export const SearchPhotos = z.object({
  results: PhotosGroupedByDate,
});

export const SearchPhotosResult = z.object({
  photosFlat: z.array(PigPhoto),
  photosGroupedByDate: PhotosGroupedByDate,
});

export const SemanticSearchPhotos = z.object({
  results: z.array(PigPhoto),
});

export type SearchPhotosResult = z.infer<typeof SearchPhotosResult>;
