import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";

export const ServerStatsQueryKeys = ["serverStats"] as const;

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
  hz_advertised_friendly: z.string(),
  hz_actual_friendly: z.string(),
  hz_advertised: z.array(z.number()),
  hz_actual: z.array(z.number()),
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

const UserStatsSchema = z.object({
  date_joined: z.string(),
  total_file_size_in_mb: z.number(),
  number_of_photos: z.number(),
  number_of_videos: z.number(),
  number_of_captions: z.number(),
  number_of_generated_captions: z.number(),
  album: z.object({
    count: z.number(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    mean: z.number().nullable(),
    median: z.number().nullable(),
    min_videos: z.number().nullable(),
    max_videos: z.number().nullable(),
    mean_videos: z.number().nullable(),
    median_videos: z.number().nullable(),
  }),
  person: z.object({
    count: z.number(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    mean: z.number().nullable(),
    median: z.number().nullable(),
  }),
  number_of_clusters: z.number(),
  places: z.object({
    count: z.number(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    mean: z.number().nullable(),
    median: z.number().nullable(),
    min_videos: z.number().nullable(),
    max_videos: z.number().nullable(),
    mean_videos: z.number().nullable(),
    median_videos: z.number().nullable(),
  }),
  things: z.object({
    count: z.number(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    mean: z.number().nullable(),
    median: z.number().nullable(),
    min_videos: z.number().nullable(),
    max_videos: z.number().nullable(),
    mean_videos: z.number().nullable(),
    median_videos: z.number().nullable(),
  }),
  events: z.object({
    count: z.number(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    mean: z.number().nullable(),
    median: z.number().nullable(),
    min_videos: z.number().nullable(),
    max_videos: z.number().nullable(),
    mean_videos: z.number().nullable(),
    median_videos: z.number().nullable(),
  }),
  number_of_favorites: z.number(),
  number_of_hidden: z.number(),
  number_of_public: z.number(),
});

export const ServerStatsResponse = z.object({
  cpu_info: CpuInfoSchema,
  image_tag: z.string(),
  available_ram_in_mb: z.number(),
  gpu_name: z.string(),
  gpu_memory_in_mb: z.string(),
  total_storage_in_mb: z.number(),
  used_storage_in_mb: z.number(),
  free_storage_in_mb: z.number(),
  number_of_users: z.number(),
  users: z.array(UserStatsSchema),
});

export type ServerStatsResponse = z.infer<typeof ServerStatsResponse>;

export const useFetchServerStatsQuery = () =>
  useQuery({
    queryKey: [...ServerStatsQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get("/serverstats/");
      return parseWithNotification(ServerStatsResponse, response, "Failed to parse server stats");
    },
  });
