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
    // The undated group's date: null from the album, person, place, thing and
    // tag lists; search, and those lists on servers before 1.3, send the legacy
    // "No timestamp" string. Accept both, so search can switch too.
    date: z.string().nullable(),
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

/** What `GET /api/search/metadata-values/` lists: camera models, camera makers or lens models. */
export const MetadataValueField = z.enum(["camera", "make", "lens"]);
export type MetadataValueField = z.infer<typeof MetadataValueField>;

/** The `file_type` search filter: the main file's type, or (raw) a photo with a RAW file. */
export const FileTypeFilter = z.enum(["image", "raw", "video"]);
export type FileTypeFilter = z.infer<typeof FileTypeFilter>;

/** One suggestion: a value as stored (filters match it ignoring case) and how many of my photos have it. */
export const MetadataValue = z.object({
  value: z.string(),
  count: z.number(),
});
export type MetadataValue = z.infer<typeof MetadataValue>;

export const MetadataValuesResponse = z.object({
  results: z.array(MetadataValue),
});
export type MetadataValuesResponse = z.infer<typeof MetadataValuesResponse>;
