// Schemas the frontend defines inside hook files (which import React Query),
// copied verbatim so the harness can import them:
//   PersonDataPointList    apps/frontend/src/api_client/stats/hooks/useFetchSocialGraphQuery.ts
//   ImageTagResponse       apps/frontend/src/api_client/server/hooks/useFetchImageTagQuery.ts
//   StorageStatsResponse   apps/frontend/src/api_client/server/hooks/useFetchStorageStatsQuery.ts
//   ServerStatsResponse    apps/frontend/src/api_client/server/hooks/useFetchServerStatsQuery.ts
//   ServerLogsViewResponse apps/frontend/src/api_client/server/hooks/useFetchServerLogsViewQuery.ts
import { z } from "zod";

export const Node = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
});

export const Link = z.object({
  source: z.string(),
  target: z.string(),
});

export const PersonDataPointList = z.object({
  nodes: Node.array(),
  links: Link.array(),
});

export const ImageTagResponse = z.object({
  image_tag: z.string(),
  git_hash: z.string(),
});

export const StorageStatsResponse = z.object({
  total_storage: z.number(),
  used_storage: z.number(),
  free_storage: z.number(),
});

export const ServerLogsViewResponse = z.object({
  logs: z.string(),
  count: z.number(),
});

const CpuInfoSchema = z.object({
  python_version: z.string(),
  cpuinfo_version: z.array(z.number()),
  cpuinfo_version_string: z.string(),
  arch: z.string(),
  bits: z.number(),
  count: z.number(),
  arch_string_raw: z.string(),
  vendor_id_raw: z.string(),
  brand_raw: z.string(),
  hz_advertised_friendly: z.string().optional(),
  hz_actual_friendly: z.string().optional(),
  hz_advertised: z.array(z.number()).optional(),
  hz_actual: z.array(z.number()).optional(),
  stepping: z.number().optional(),
  model: z.number(),
  family: z.number().optional(),
  flags: z.array(z.string()),
  l3_cache_size: z.number().optional(),
  l2_cache_size: z.union([z.string(), z.number()]).optional(),
  l1_data_cache_size: z.number().optional(),
  l1_instruction_cache_size: z.union([z.string(), z.number()]).optional(),
  l2_cache_line_size: z.number().optional(),
  l2_cache_associativity: z.number().optional(),
});

const GroupStats = z.object({
  count: z.number(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  mean: z.number().nullable(),
  median: z.number().nullable(),
  min_videos: z.number().nullable(),
  max_videos: z.number().nullable(),
  mean_videos: z.number().nullable(),
  median_videos: z.number().nullable(),
});

const UserStatsSchema = z.object({
  date_joined: z.string(),
  total_file_size_in_mb: z.number(),
  number_of_photos: z.number(),
  number_of_videos: z.number(),
  number_of_captions: z.number(),
  number_of_generated_captions: z.number(),
  album: GroupStats,
  person: z.object({
    count: z.number(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    mean: z.number().nullable(),
    median: z.number().nullable(),
  }),
  number_of_clusters: z.number(),
  places: GroupStats,
  things: GroupStats,
  events: GroupStats,
  number_of_favorites: z.number(),
  number_of_hidden: z.number(),
  number_of_public: z.number(),
});

export const ServerStatsResponse = z.object({
  cpu_info: CpuInfoSchema,
  image_tag: z.string(),
  available_ram_in_mb: z.number(),
  gpu_name: z.string(),
  gpu_memory_in_mb: z.union([z.string(), z.number()]),
  total_storage_in_mb: z.number(),
  used_storage_in_mb: z.number(),
  free_storage_in_mb: z.number(),
  number_of_users: z.number(),
  users: z.array(UserStatsSchema),
});

// The detect/resolve/dismiss/revert/delete answers the duplicates hooks type
// with TS interfaces only (apps/frontend/src/api_client/duplicates/hooks.ts).
export const StatusOnly = z.object({ status: z.string() });
export const RevertResponse = z.object({ status: z.string(), restored_count: z.number() });
export const UnlinkResponse = z.object({ status: z.string(), unlinked_count: z.number() });
