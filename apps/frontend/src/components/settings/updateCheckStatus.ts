import type { UpdateStatus } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { DateTime } from "luxon";
import { parseInstant } from "../../util/dateUtils";

/** Which icon and colour the line under Check for new releases gets. */
export type UpdateCheckTone = "idle" | "ok" | "available" | "failed";

export type UpdateCheckStatusLine = { tone: UpdateCheckTone; text: string };

/** Each state the server reports, with its tone and sentence. */
const LINES = {
  off: { tone: "idle", key: "sitesettings.updatecheck_off" },
  development: { tone: "idle", key: "sitesettings.updatecheck_development" },
  not_checked: { tone: "idle", key: "sitesettings.updatecheck_not_checked" },
  failed: { tone: "failed", key: "sitesettings.updatecheck_failed" },
  up_to_date: { tone: "ok", key: "sitesettings.updatecheck_up_to_date" },
  available: { tone: "available", key: "sitesettings.updatecheck_available" },
  skipped: { tone: "available", key: "sitesettings.updatecheck_skipped" },
} as const satisfies Record<string, { tone: UpdateCheckTone; key: string }>;

type KnownState = keyof typeof LINES;

function isKnownState(state: string): state is KnownState {
  return Object.hasOwn(LINES, state);
}

/** When the last check ran, relative ("2 hours ago"). */
function checkedWhen(status: UpdateStatus): string {
  return status.checked_at ? (parseInstant(status.checked_at).toRelative() ?? "") : "";
}

/**
 * What the last check found, for the line under the switch (#2311); null when the switch says it
 * all (locked by the environment) or the server sent a state this client does not know.
 * `gitHash` names the commit of a development build.
 */
export function updateCheckStatusLine(
  status: UpdateStatus,
  gitHash: string | undefined,
  t: TFunction
): UpdateCheckStatusLine | null {
  if (!isKnownState(status.status)) return null;
  const { tone, key } = LINES[status.status];
  const text = t(key, {
    hash: gitHash ?? "?",
    when: checkedWhen(status),
    error: status.error ?? "",
    current: status.current,
    latest: status.latest ?? "",
  });
  return { tone, text };
}

/** The day a release came out, in the reader's locale. */
export function publishedDate(status: UpdateStatus): string | null {
  return status.published_at ? parseInstant(status.published_at).toLocaleString(DateTime.DATE_MED) : null;
}
