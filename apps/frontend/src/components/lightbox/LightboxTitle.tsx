import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { parsePhotoTimestamp } from "../../util/dateUtils";
import classes from "./LightboxControls.module.css";
import { useCompactViewer } from "./useCompactViewer";

/** Where the shown photo is in the list the lightbox steps through, counted from 1. */
type LightboxPosition = Readonly<{ current: number; total: number }>;

type Props = Readonly<{
  /** The photo's `exif_timestamp`, from its details or (for a viewer who is not the owner) the grid. */
  timestamp?: string | null;
  /** The photo's place name (`search_location`). */
  place?: string | null;
  position?: LightboxPosition;
}>;

/** "Baixa, Lisbon, Portugal" as "Baixa, Lisbon": the neighbourhood and town say enough up here. */
function shortPlace(place: string): string {
  return place
    .split(",")
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
}

/**
 * The centred title of the lightbox toolbar, as Apple Photos has it: the day the photo was taken,
 * and under it, dimmed, where and which of how many ("Baixa, Lisbon · 12 of 198"), so stepping
 * through a long list does not lose the reader. Nothing when none of it is known.
 */
export function LightboxTitle({ timestamp, place, position }: Props) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  // A phone has room for one line: "Oct 17, 2026". The place is in the info sheet.
  const compact = useCompactViewer();
  const taken = timestamp ? parsePhotoTimestamp(timestamp) : null;
  const date = taken?.isValid
    ? taken.toLocaleString(compact ? DateTime.DATE_MED : DateTime.DATE_MED_WITH_WEEKDAY)
    : null;
  if (compact) {
    return date ? (
      <div className={classes.title}>
        <div className={classes.titleDate}>{date}</div>
      </div>
    ) : null;
  }
  const where = place ? shortPlace(place) : null;
  const which =
    position && position.total > 1
      ? t("lightbox.position", {
          current: position.current.toLocaleString(locale),
          total: position.total.toLocaleString(locale),
        })
      : null;
  if (!date && !where && !which) return null;
  return (
    <div className={classes.title}>
      {date && <div className={classes.titleDate}>{date}</div>}
      {(where || which) && (
        // The place gives way on a narrow screen; the position always shows whole.
        <div className={classes.titleMeta}>
          {where && (
            <span className={classes.titlePlace} title={place ?? undefined}>
              {where}
            </span>
          )}
          {where && which && <span aria-hidden="true">·</span>}
          {which && <span className={classes.titlePosition}>{which}</span>}
        </div>
      )}
    </div>
  );
}
