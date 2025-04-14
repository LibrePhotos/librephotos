import { z } from "zod";
import { PigPhoto } from "../photos/types";

export const SearchExamples = z.array(z.string());
export const SearchExamplesResponse = z.object({
  results: SearchExamples,
});
export type SearchExamples = z.infer<typeof SearchExamples>;

export const PhotosGroupedByDate = z.array(
  z.object({
    date: z.string(),
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

export type SearchPhotosResult = z.infer<typeof SearchPhotosResult>; 