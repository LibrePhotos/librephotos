import type { TFunction } from "i18next";
import { DateTime } from "luxon";
import { parseInstant } from "../../util/dateUtils";

export function isLinkExpired(expiresAt: string | null | undefined, now: DateTime = DateTime.now()): boolean {
  if (!expiresAt) return false;
  const instant = parseInstant(expiresAt);
  return instant.isValid && instant < now;
}

export function linkExpiryCaption(
  t: TFunction,
  expiresAt: string | null | undefined,
  now: DateTime = DateTime.now()
): string | null {
  if (!expiresAt) return null;
  const instant = parseInstant(expiresAt);
  if (!instant.isValid) return null;
  const date = instant.toRelative({ base: now }) ?? "";
  return instant < now ? t("sharing.expiredOn", { date }) : t("sharing.expiresOn", { date });
}
