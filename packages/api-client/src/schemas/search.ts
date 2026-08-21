import { z } from "zod";
import { PigPhoto } from "./common";

export const SearchExamples = z.array(z.string());
export type SearchExamples = z.infer<typeof SearchExamples>;

export const SearchExamplesResponse = z.object({
  results: SearchExamples,
});
export type SearchExamplesResponse = z.infer<typeof SearchExamplesResponse>;

export const PhotosGroupedByDate = z.array(
  z.object({
    date: z.string(),
    location: z.string(),
    items: z.array(PigPhoto),
  })
);
export type PhotosGroupedByDate = z.infer<typeof PhotosGroupedByDate>;

export const SearchPhotos = z.object({
  results: PhotosGroupedByDate,
});
export type SearchPhotos = z.infer<typeof SearchPhotos>;

export const SemanticSearchPhotos = z.object({
  results: z.array(PigPhoto),
});
export type SemanticSearchPhotos = z.infer<typeof SemanticSearchPhotos>;

export const SearchPhotosResult = z.object({
  photosFlat: z.array(PigPhoto),
  photosGroupedByDate: PhotosGroupedByDate,
});
export type SearchPhotosResult = z.infer<typeof SearchPhotosResult>;
