export type { AppDatabase } from "./database";
export type MergedTimelineRow = {
  remote_id: string | null;
  local_id: string | null;
  timestamp: number | null;
  type: string | null;
  aspect_ratio: number | null;
  is_favorite: number;
  bucket_day: string;
  image_hash: string | null;
  local_uri: string | null;
  dominant_color: string | null;
  processing: number;
};

export type TimelineBucket = {
  bucket_day: string;
  count: number;
};
