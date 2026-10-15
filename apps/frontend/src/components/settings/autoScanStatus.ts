import type { SiteAutoScanStatus } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { DateTime } from "luxon";
import { parseInstant } from "../../util/dateUtils";

/** The automatic scan's frequencies (AUTO_SCAN in the backend). */
export const AUTO_SCAN_FREQUENCIES = ["off", "hourly", "daily", "custom"] as const;
export type AutoScanFrequency = (typeof AUTO_SCAN_FREQUENCIES)[number];

export function isAutoScanFrequency(value: string | null | undefined): value is AutoScanFrequency {
  return AUTO_SCAN_FREQUENCIES.some(frequency => frequency === value);
}

/** Which icon and colour the status line gets: the worst thing the last run did. */
export type AutoScanTone = "idle" | "ok" | "running" | "skipped" | "failed";

export type AutoScanStatusLine = { tone: AutoScanTone; text: string };

function toneOf(status: SiteAutoScanStatus): AutoScanTone {
  if (!status.last_run_at) return "idle";
  if (status.failed.length) return "failed";
  if (status.skipped.length) return "skipped";
  if (status.running.length) return "running";
  return "ok";
}

function formatInstant(iso: string): string {
  return parseInstant(iso).toLocaleString(DateTime.DATETIME_MED);
}

/** What the last run did, sentence by sentence. */
function lastRunSentences(status: SiteAutoScanStatus, lastRunAt: string, t: TFunction): string[] {
  const when = formatInstant(lastRunAt);
  const names = (users: string[]) => users.join(", ");
  const total = status.scanned.length + status.running.length + status.skipped.length + status.failed.length;
  const sentences = [
    total === 0
      ? t("sitesettings.autoscanstatusnolibrary", { when })
      : t("sitesettings.autoscanstatusscanned", { when, count: status.scanned.length }),
  ];
  if (status.running.length) sentences.push(t("sitesettings.autoscanstatusrunning", { names: names(status.running) }));
  if (status.skipped.length) sentences.push(t("sitesettings.autoscanstatusskipped", { names: names(status.skipped) }));
  if (status.failed.length) sentences.push(t("sitesettings.autoscanstatusfailed", { names: names(status.failed) }));
  return sentences;
}

/**
 * The status line under the setting: the last run (scanned, still running, skipped because a scan
 * was running, failed) and the next one, in the viewer's time zone. Each tone also has its words,
 * so the line does not rely on colour.
 */
export function autoScanStatusLine(status: SiteAutoScanStatus, t: TFunction): AutoScanStatusLine {
  const sentences = status.last_run_at
    ? lastRunSentences(status, status.last_run_at, t)
    : [t("sitesettings.autoscanstatusnever")];
  if (status.next_run_at) {
    sentences.push(t("sitesettings.autoscanstatusnext", { when: formatInstant(status.next_run_at) }));
  }
  return { tone: toneOf(status), text: sentences.join(" ") };
}
