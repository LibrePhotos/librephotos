import type { JobDetail } from "@librephotos/api-client";
import type { ParseKeys, TFunction } from "i18next";

// LongRunningJob.JOB_TYPES in apps/backend/api/models/long_running_job.py, by number. The keys are
// named after the backend's JOB_* constants.
const JOB_TYPE_KEYS: Partial<Record<number, ParseKeys>> = {
  1: "jobs.type.scan_photos",
  2: "jobs.type.generate_auto_albums",
  3: "jobs.type.generate_auto_album_titles",
  4: "jobs.type.train_faces",
  5: "jobs.type.delete_missing_photos",
  6: "jobs.type.calculate_clip_embeddings",
  7: "jobs.type.scan_faces",
  8: "jobs.type.cluster_all_faces",
  9: "jobs.type.download_photos",
  10: "jobs.type.download_models",
  11: "jobs.type.add_geolocation",
  12: "jobs.type.generate_tags",
  13: "jobs.type.generate_face_embeddings",
  14: "jobs.type.scan_missing_photos",
  15: "jobs.type.detect_duplicates",
  16: "jobs.type.repair_file_variants",
  17: "jobs.type.classify_media",
  18: "jobs.type.generate_ocr",
  19: "jobs.type.probe_videos",
  22: "jobs.type.detect_stacks",
  23: "jobs.type.strip_thumbnail_metadata",
  24: "jobs.type.empty_trash",
  25: "jobs.type.generate_captions",
  26: "jobs.type.reapply_date_rules",
  27: "jobs.type.write_metadata",
  28: "jobs.type.refresh_exposure_times",
  29: "jobs.type.look_up_places",
  30: "jobs.type.move_photos",
};

/**
 * A job's type in the UI language. A type this app does not know yet (a newer backend) is still
 * named, with the backend's English name inside a translated phrase.
 */
export function jobTypeLabel(job: Pick<JobDetail, "job_type" | "job_type_str">, t: TFunction): string {
  const key = JOB_TYPE_KEYS[job.job_type];
  return key ? t(key) : t("jobs.type.unknown", { name: job.job_type_str });
}
