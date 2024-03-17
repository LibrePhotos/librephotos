import { z } from "zod";

export type ServerStatsResponseType = z.infer<typeof ServerStatsResponse>;

// To-Do: Add a type for this
export const ServerStatsResponse = z.any();

export type StorageStatsResponseType = z.infer<typeof StorageStatsResponse>;

export const StorageStatsResponse = z.object({
  used_storage: z.number(),
  total_storage: z.number(),
  free_storage: z.number(),
});

export type ImageTagResponseType = z.infer<typeof ImageTagResponse>;

export const ImageTagResponse = z.object({
  image_tag: z.string(),
  git_hash: z.string(),
});
