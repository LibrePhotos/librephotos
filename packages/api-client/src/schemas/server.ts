import { z } from "zod";

/*
 * What the server says about itself (api/views/server_info.py, api/views/dataviz.py,
 * api/views/services.py). The views answer plain dicts; the response serializers of the first
 * two are in api/serializers/server.py.
 */

/** `GET /imagetag/`: the build the server runs. */
export const ImageTag = z.object({
  image_tag: z.string(),
  git_hash: z.string(),
});
export type ImageTag = z.infer<typeof ImageTag>;

/** `GET /storagestats/` (bytes). */
export const StorageStats = z.object({
  total_storage: z.number(),
  used_storage: z.number(),
  free_storage: z.number(),
});
export type StorageStats = z.infer<typeof StorageStats>;

/** `GET /serverlogs/view?lines=`: the last lines of the server log (admin). */
export const ServerLogs = z.object({
  logs: z.string(),
  count: z.number(),
});
export type ServerLogs = z.infer<typeof ServerLogs>;

/**
 * py-cpuinfo's get_cpu_info() (api/dataviz/stats.py _get_cpu_info), with numeric cache sizes. Only
 * the first seven keys are always there: py-cpuinfo drops every other one it cannot read, or reads
 * as empty or 0 (an ARM board without lscpu has no vendor, brand or flags; model 0 has no `model`).
 */
const CpuInfo = z.object({
  python_version: z.string(),
  cpuinfo_version: z.array(z.number()),
  cpuinfo_version_string: z.string(),
  arch: z.string(),
  bits: z.number(),
  count: z.number(),
  arch_string_raw: z.string(),
  vendor_id_raw: z.string().optional(),
  hardware_raw: z.string().optional(),
  brand_raw: z.string().optional(),
  uname_string_raw: z.string().optional(),
  processor_type: z.string().optional(),
  hz_advertised_friendly: z.string().optional(),
  hz_actual_friendly: z.string().optional(),
  hz_advertised: z.array(z.number()).optional(),
  hz_actual: z.array(z.number()).optional(),
  stepping: z.number().optional(),
  model: z.number().optional(),
  family: z.number().optional(),
  flags: z.array(z.string()).optional(),
  l3_cache_size: z.number().optional(),
  l2_cache_size: z.number().optional(),
  l1_data_cache_size: z.number().optional(),
  l1_instruction_cache_size: z.number().optional(),
  l2_cache_line_size: z.number().optional(),
  l2_cache_associativity: z.number().optional(),
});

/** Photo counts over a kind of album (api/dataviz/stats.py _photo_group_stats). */
const PhotoGroupStats = z.object({
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

/** One user's library in the server stats (api/dataviz/stats.py _get_user_stats). */
const UserStats = z.object({
  date_joined: z.string(),
  total_file_size_in_mb: z.number(),
  number_of_photos: z.number(),
  number_of_videos: z.number(),
  /** Optional: servers before 2026-07 (#1943) do not count them. */
  number_of_screenshots: z.number().optional(),
  number_of_documents: z.number().optional(),
  number_of_captions: z.number(),
  number_of_generated_captions: z.number(),
  album: PhotoGroupStats,
  person: z.object({
    count: z.number(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    mean: z.number().nullable(),
    median: z.number().nullable(),
  }),
  number_of_clusters: z.number(),
  places: PhotoGroupStats,
  things: PhotoGroupStats,
  events: PhotoGroupStats,
  number_of_favorites: z.number(),
  number_of_hidden: z.number(),
  number_of_public: z.number(),
});

/** `GET /serverstats/` (admin): the machine and every user's library, for the bug-report download. */
export const ServerStats = z.object({
  cpu_info: CpuInfo,
  image_tag: z.string(),
  available_ram_in_mb: z.number(),
  gpu_name: z.string(),
  gpu_memory_in_mb: z.union([z.string(), z.number()]),
  total_storage_in_mb: z.number(),
  used_storage_in_mb: z.number(),
  free_storage_in_mb: z.number(),
  number_of_users: z.number(),
  users: z.array(UserStats),
});
export type ServerStats = z.infer<typeof ServerStats>;

/** `GET /services/` (admin): every sidecar service by name. */
export const ServicesList = z.object({
  services: z.record(z.string(), z.number()),
});
export type ServicesList = z.infer<typeof ServicesList>;

/**
 * `GET /services/{name}/` (admin). `enabled` and `feature_flag` are optional so that a backend
 * predating them reads as an ordinary always-on service rather than failing the parse.
 * `port_conflict` says, in English, which program holds the port of an enabled service that is
 * down, e.g. "port 8010 is used by python.exe (process ID 4321)" (#2324); null when nothing else
 * holds it, absent on older backends.
 */
export const ServiceHealth = z.object({
  service_name: z.string(),
  healthy: z.boolean(),
  enabled: z.boolean().optional(),
  feature_flag: z.string().nullable().optional(),
  port_conflict: z.string().nullable().optional(),
});
export type ServiceHealth = z.infer<typeof ServiceHealth>;

/** `POST /services/{name}/start/` and `.../stop/` (admin): what happened, in English. */
export const ServiceActionResponse = z.object({
  message: z.string(),
});
export type ServiceActionResponse = z.infer<typeof ServiceActionResponse>;

/**
 * The 503 body of `GET /healthz/ready/` (and of every other `/api/` path) while LibrePhotos is not
 * serving yet (#2310): the startup placeholder that answers on the backend port during the database
 * update says what it is doing. `reason_code` names why an update failed (`E001`: the database is
 * too old for this release, `E002`: a newer release has written it, `unknown`: anything else, the
 * reason is in the log); `version` is the release that is starting. Fixed codes only: the answer
 * is anonymous, so it never carries exception text or paths. Not in openapi.json: the placeholder
 * is not a Django view. The running server answers this path itself, with `HealthReady`.
 */
export const StartupStatus = z.object({
  status: z.enum(["starting", "updating", "failed"]),
  reason_code: z.string().optional(),
  version: z.string().optional(),
});
export type StartupStatus = z.infer<typeof StartupStatus>;

/** Why the server is not serving yet; `unreachable` when nothing answered for it. */
export type BackendNotReady = {
  state: StartupStatus["status"] | "unreachable";
  /** Why an update `failed`: the server's reason code, `null` when it sent none. */
  reasonCode: string | null;
  version: string | null;
};

/** What `fetchBackendReadiness` makes of the readiness probe. */
export type BackendReadiness = { state: "ready" } | BackendNotReady;
