import type { ErrorReport } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { DateTime } from "luxon";
import { parseInstant } from "../../util/dateUtils";

/**
 * Where Email sends a saved error report (#2938). A placeholder until the maintainers pick the
 * address; this is its one copy.
 */
export const REPORT_EMAIL = "REPORT_EMAIL_PLACEHOLDER@example.invalid";

/** "Server" or "Web app"; a source a newer server adds shows as it is. */
export function sourceLabel(source: string, t: TFunction): string {
  if (source === "server") return t("errorreports.source_server");
  if (source === "browser") return t("errorreports.source_browser");
  return source;
}

/**
 * A `mailto:` link to the maintainers with the report's title as the subject and a short summary
 * as the body. Mail links cannot carry a file, so the body asks for the downloaded report.
 */
export function errorReportMailto(report: ErrorReport, t: TFunction): string {
  const subject = t("errorreports.email_subject", { title: report.title, interpolation: { escapeValue: false } });
  const body = t("errorreports.email_body", {
    title: report.title,
    release: report.release,
    source: sourceLabel(report.source, t),
    firstSeen: parseInstant(report.first_seen).toLocaleString(DateTime.DATETIME_MED),
    occurrences: report.occurrences,
    id: report.id,
    interpolation: { escapeValue: false },
  });
  return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
