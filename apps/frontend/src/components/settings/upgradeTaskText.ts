import type { UpgradeTask } from "@librephotos/api-client";
import type { TFunction } from "i18next";

/** The keys of `api.jobs.upgrade_tasks.UPGRADE_TASKS` in the backend that this app has words for. */
type KnownTask = "semantic_search_conversion" | "strip_thumbnail_metadata" | "refresh_exposure_times" | "probe_videos";

function isKnownTask(key: string): key is KnownTask {
  return (
    key === "semantic_search_conversion" ||
    key === "strip_thumbnail_metadata" ||
    key === "refresh_exposure_times" ||
    key === "probe_videos"
  );
}

function knownTitle(key: KnownTask, count: number | null, t: TFunction): string {
  switch (key) {
    case "probe_videos":
      return count === null
        ? t("upgradetasks.probe_videos.title")
        : t("upgradetasks.probe_videos.titlecount", { count });
    case "semantic_search_conversion":
    case "strip_thumbnail_metadata":
    case "refresh_exposure_times":
      return t(`upgradetasks.${key}.title`);
  }
}

/** A task's title in the UI language. A task this app does not know yet (a newer backend) is still named. */
export function upgradeTaskTitle(task: Pick<UpgradeTask, "key" | "count">, t: TFunction): string {
  return isKnownTask(task.key)
    ? knownTitle(task.key, task.count, t)
    : t("upgradetasks.unknown.title", { key: task.key });
}

/** The task's one sentence: why it is needed, and that the photos are not changed. */
export function upgradeTaskDescription(task: Pick<UpgradeTask, "key">, t: TFunction): string {
  return isKnownTask(task.key) ? t(`upgradetasks.${task.key}.description`) : t("upgradetasks.unknown.description");
}
