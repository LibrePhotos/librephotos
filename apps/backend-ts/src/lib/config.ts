// Process configuration from the environment. Same variable names as Django
// and librephotos-rs, so the bench/test scripts can start any of the three.
import path from "node:path";

const env = process.env;
const bool = (v: string | undefined, d: boolean) =>
  v === undefined || v === "" ? d : ["1", "true", "yes", "on"].includes(v.toLowerCase());

const baseData = env.BASE_DATA ?? "/";

export const config = {
  dbHost: env.DB_HOST ?? "localhost",
  dbPort: Number(env.DB_PORT ?? 5432),
  dbName: env.DB_NAME ?? "librephotos",
  dbUser: env.DB_USER ?? "docker",
  dbPass: env.DB_PASS ?? "AaAa1234",
  dbPool: Number(env.LP_DB_POOL ?? 12),
  secretKey: env.SECRET_KEY ?? "",
  baseData,
  baseLogs: env.BASE_LOGS ?? path.join(baseData, "logs"),
  photos: env.PHOTOS ?? path.join(baseData, "data"),
  mediaRoot: path.join(baseData, "protected_media"),
  mediaMode: (env.LP_MEDIA_MODE ?? "x-accel") as "x-accel" | "direct",
  accessTokenMinutes: Number(env.ACCESS_TOKEN_MINUTES ?? 5),
  refreshTokenDays: Number(env.REFRESH_TOKEN_DAYS ?? 7),
  allowUpload: bool(env.ALLOW_UPLOAD, true),
  nextcloudEnabled: bool(env.NEXTCLOUD_ENABLED, true),
  skipPatterns: env.SKIP_PATTERNS ?? "",
  mapApiProvider: env.MAP_API_PROVIDER ?? "photon",
  mapboxApiKey: env.MAPBOX_API_KEY ?? "",
  mapTileProvider: env.MAP_TILE_PROVIDER ?? "openstreetmap",
  exiftool: env.LP_EXIFTOOL,
  ffmpeg: env.LP_FFMPEG ?? "ffmpeg",
  ffprobe: env.LP_FFPROBE ?? "ffprobe",
  python: env.LP_PYTHON ?? "python",
  workerConcurrency: Number(env.WORKER_CONCURRENCY ?? 4),
  scanConcurrency: Number(env.LP_SCAN_CONCURRENCY ?? env.WORKER_CONCURRENCY ?? 4),
  features: {
    faceDetection: bool(env.FEATURE_FACE_DETECTION, true),
    faceCluster: bool(env.FEATURE_FACE_CLUSTER, true),
    imageCaptioning: bool(env.FEATURE_IMAGE_CAPTIONING, true),
    reverseGeocoding: bool(env.FEATURE_REVERSE_GEOCODING, true),
    sceneClassification: bool(env.FEATURE_SCENE_CLASSIFICATION, true),
    video: bool(env.FEATURE_VIDEO, true),
    processEmbeddedMedia: bool(env.FEATURE_PROCESS_EMBEDDED_MEDIA, true),
  },
  /** Python ML sidecar base URLs (LP_SIDECAR_<NAME>_URL), as in librephotos-rs. */
  sidecar: (name: string, port: number) =>
    env[`LP_SIDECAR_${name.toUpperCase()}_URL`] ?? `http://localhost:${port}`,
  demoSite: bool(env.DEMO_SITE, false),
  workerEnabled: bool(env.LP_WORKER, true),
};

export type Config = typeof config;
