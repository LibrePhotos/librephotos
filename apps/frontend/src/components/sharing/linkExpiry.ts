import type { TFunction } from "i18next";
import { DateTime } from "luxon";
import { parseInstant } from "../../util/dateUtils";

export function isLinkExpired(expiresAt: string | null | undefined, now: DateTime = DateTime.now()): boolean {
  if (!expiresAt) return false;
  const instant = parseInstant(expiresAt);
  return instant.isValid && instant < now;
}

function relativeToNow(instant: DateTime, now: DateTime): string {
  const format = new Intl.RelativeTimeFormat(now.locale ?? undefined, { numeric: "auto" });
  const days = Math.round(instant.diff(now, "days").days);
  if (Math.abs(days) >= 1) return format.format(days, "day");
  const hours = Math.round(instant.diff(now, "hours").hours);
  if (Math.abs(hours) >= 1) return format.format(hours, "hour");
  return format.format(Math.round(instant.diff(now, "minutes").minutes), "minute");
}

export function linkExpiryCaption(
  t: TFunction,
  expiresAt: string | null | undefined,
  now: DateTime = DateTime.now()
): string | null {
  if (!expiresAt) return null;
  const instant = parseInstant(expiresAt);
  if (!instant.isValid) return null;
  const date = relativeToNow(instant, now);
  return instant < now ? t("sharing.expiredOn", { date }) : t("sharing.expiresOn", { date });
}
