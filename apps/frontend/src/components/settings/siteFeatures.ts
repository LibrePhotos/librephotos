import type { SiteFeatureName, SiteFeatures, SiteModelDownload, SiteSettingsUpdate } from "@librephotos/api-client";
import type { ParseKeys } from "i18next";

export type SiteFeatureState = NonNullable<SiteFeatures[SiteFeatureName]>;

/** One row of the Features card: its texts and the POST body that sets its switch. */
type FeatureRow = {
  name: SiteFeatureName;
  label: ParseKeys;
  description: ParseKeys;
  /** What a scan skips while the feature is off. */
  off: ParseKeys;
  /** A further note while it is off, e.g. what happens to what the feature already made. */
  offNote?: ParseKeys;
  /** The feature this one refines: the row is indented under it and disabled while it is off. */
  parent?: SiteFeatureName;
  update: (enabled: boolean) => SiteSettingsUpdate;
};

/** The optional features (#2217), in the order the card lists them. */
export const FEATURE_ROWS: readonly FeatureRow[] = [
  {
    name: "face_detection",
    label: "sitesettings.feature_face_detection",
    description: "sitesettings.feature_face_detection_description",
    off: "sitesettings.feature_face_detection_off",
    update: enabled => ({ face_detection_enabled: enabled }),
  },
  {
    name: "face_detection_in_videos",
    label: "sitesettings.feature_face_detection_in_videos",
    description: "sitesettings.feature_face_detection_in_videos_description",
    off: "sitesettings.feature_face_detection_in_videos_off",
    parent: "face_detection",
    update: enabled => ({ face_detection_in_videos_enabled: enabled }),
  },
  {
    name: "face_cluster",
    label: "sitesettings.feature_face_cluster",
    description: "sitesettings.feature_face_cluster_description",
    off: "sitesettings.feature_face_cluster_off",
    update: enabled => ({ face_cluster_enabled: enabled }),
  },
  {
    name: "image_captioning",
    label: "sitesettings.feature_image_captioning",
    description: "sitesettings.feature_image_captioning_description",
    off: "sitesettings.feature_image_captioning_off",
    update: enabled => ({ image_captioning_enabled: enabled }),
  },
  {
    name: "scene_classification",
    label: "sitesettings.feature_scene_classification",
    description: "sitesettings.feature_scene_classification_description",
    off: "sitesettings.feature_scene_classification_off",
    update: enabled => ({ scene_classification_enabled: enabled }),
  },
  {
    name: "reverse_geocoding",
    label: "sitesettings.feature_reverse_geocoding",
    description: "sitesettings.feature_reverse_geocoding_description",
    off: "sitesettings.feature_reverse_geocoding_off",
    update: enabled => ({ reverse_geocoding_enabled: enabled }),
  },
  {
    name: "video",
    label: "sitesettings.feature_video",
    description: "sitesettings.feature_video_description",
    off: "sitesettings.feature_video_off",
    update: enabled => ({ video_enabled: enabled }),
  },
  {
    name: "video_previews",
    label: "sitesettings.feature_video_previews",
    description: "sitesettings.feature_video_previews_description",
    off: "sitesettings.feature_video_previews_off",
    offNote: "sitesettings.feature_video_previews_existing",
    parent: "video",
    update: enabled => ({ video_previews_enabled: enabled }),
  },
];

/** The environment variable that locks a feature off, e.g. FEATURE_IMAGE_CAPTIONING. */
export function envVariable(name: SiteFeatureName): string {
  return `FEATURE_${name.toUpperCase()}`;
}

/** What the line under a switch says about the feature's model. */
export type ModelStatus = "none" | "ready" | "missing" | "downloading" | "failed";

/**
 * The model line for a feature: nothing while it is off or needs no model; otherwise ready, or
 * what the newest model download is doing about it.
 */
export function modelStatus(state: SiteFeatureState, download: SiteModelDownload | null | undefined): ModelStatus {
  if (!state.enabled || state.model_ready === null) {
    return "none";
  }
  if (state.model_ready) {
    return "ready";
  }
  if (download?.status === "running") {
    return "downloading";
  }
  return download?.status === "failed" ? "failed" : "missing";
}

/** The download's progress in percent; 0 until the job knows how many models it fetches. */
export function downloadPercent(download: SiteModelDownload): number {
  if (download.progress_target <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((download.progress_current / download.progress_target) * 100));
}
