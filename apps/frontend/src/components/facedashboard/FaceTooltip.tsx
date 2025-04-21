import { Tooltip } from "@mantine/core";
import { t } from "i18next";
import { DateTime } from "luxon";
import React from "react";

  import { i18nResolvedLanguage } from "../../i18n";
  import { getRouteApi } from "@tanstack/react-router";
import { FacesTab } from "../../api_client/faces";

type Props = Readonly<{
  tooltipOpened: boolean;
  probability: number;
  timestamp?: string;
  children?: React.ReactNode;
}>;

const routeApi = getRouteApi("/_protected/faces");

export function FaceTooltip({ tooltipOpened, probability, timestamp, children = null }: Props) {
  const { tab: activeTab } = routeApi.useSearch();

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
