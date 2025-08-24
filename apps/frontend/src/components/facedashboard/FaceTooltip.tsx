import { Tooltip } from "@mantine/core";
import { t } from "i18next";
import { DateTime } from "luxon";
import React from "react";

import { getRouteApi } from "@tanstack/react-router";
import { i18nResolvedLanguage } from "../../i18n";
import { FacesTab } from "../../api_client/faces";

type Props = Readonly<{
  tooltipOpened: boolean;
  probability: number;
  timestamp?: string;
  children?: React.ReactNode;
  tab?: FacesTab;
}>;

const routeApi = getRouteApi("/_protected/faces");

export function FaceTooltip({ tooltipOpened, probability, timestamp, tab, children = null }: Props) {
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
    activeTab === "inferred"
      ? t("settings.confidencepercentage", { percentage: (probability * 100).toFixed(1) })
      : null;

  const dateTimeLabel = DateTime.fromISO(timestamp || "undefined").isValid
    ? DateTime.fromISO(timestamp || "undefined")
        .setLocale(i18nResolvedLanguage())
        .toLocaleString(DateTime.DATETIME_MED)
    : null;

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
