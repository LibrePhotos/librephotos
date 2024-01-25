import { Tooltip } from "@mantine/core";
import { t } from "i18next";
import { DateTime } from "luxon";
import React from "react";

import { i18nResolvedLanguage } from "../../i18n";
import { useAppSelector } from "../../store/store";

type Props = Readonly<{
  tooltipOpened: boolean;
  cell: any;
  children?: React.ReactNode;
}>;

export function FaceTooltip({ tooltipOpened, cell, children }: Props) {
  const { activeTab } = useAppSelector(store => store.face);

  const confidencePercentageLabel =
    activeTab === "inferred"
      ? t("settings.confidencepercentage", { percentage: (cell.person_label_probability * 100).toFixed(1) })
      : null;

  const dateTimeLabel = DateTime.fromISO(cell.timestamp).isValid
    ? DateTime.fromISO(cell.timestamp).setLocale(i18nResolvedLanguage()).toLocaleString(DateTime.DATETIME_MED)
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

FaceTooltip.defaultProps = {
  children: null,
};
