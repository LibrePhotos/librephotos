import { Tooltip } from "@mantine/core";
import { getRouteApi } from "@tanstack/react-router";
import { t } from "i18next";
import { DateTime } from "luxon";
import React from "react";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { parsePhotoTimestamp } from "../../util/dateUtils";
import { formatPercent } from "../../util/formatCount";
import type { FacesTab } from "./facesTab";

type Props = Readonly<{
  tooltipOpened: boolean;
  probability: number;
  timestamp?: string | null;
  children?: React.ReactNode;
  tab?: FacesTab;
}>;

const routeApi = getRouteApi("/_protected/faces");

export function FaceTooltip({ tooltipOpened, probability, timestamp, tab, children = null }: Props) {
  const locale = useFormatLocale();
  let activeTab: FacesTab | undefined;
  try {
    // Try to get the tab from the route if we're in the faces dashboard
    const { tab: routeTab } = routeApi.useSearch();
    activeTab = routeTab;
  } catch {
    // If we're not in the faces dashboard, use the provided tab or undefined
    activeTab = tab;
  }

  const confidencePercentageLabel =
    activeTab === "inferred" ? t("settings.confidencepercent", { percent: formatPercent(probability, locale) }) : null;

  // The face's timestamp is its photo's exif_timestamp: a wall clock, not an instant
  const photoTime = timestamp ? parsePhotoTimestamp(timestamp) : null;
  const dateTimeLabel = photoTime?.isValid ? photoTime.toLocaleString(DateTime.DATETIME_MED) : null;

  const tooltipIsEmpty = confidencePercentageLabel === null && dateTimeLabel === null;
  const tooltipLabel = () => {
    if (tooltipIsEmpty) {
      return null;
    }
    return (
      <div>
        {confidencePercentageLabel}
        <div>{dateTimeLabel}</div>
      </div>
    );
  };

  return (
    <Tooltip opened={tooltipOpened && !tooltipIsEmpty} label={tooltipLabel()} position="bottom" withArrow>
      {children}
    </Tooltip>
  );
}
