import { Tooltip } from "@mantine/core";
import { t } from "i18next";
import React, { useState } from "react";
import { DateTime } from 'luxon';
import i18n from "../../i18n";

type Props = {
  tooltipOpened: boolean;
  cell: any;
  activeItem: number;
  children?: React.ReactNode;
};

export function FaceTooltip({tooltipOpened, cell, activeItem, children}: Props) {
  const confidencePercentageLabel = activeItem === 1
  ? t<string>("settings.confidencepercentage", {percentage: (cell.person_label_probability * 100).toFixed(1),})
  : null;

  const dateTimeLabel = DateTime.fromISO(cell.timestamp).isValid
  ? DateTime.fromISO(cell.timestamp).setLocale(i18n.resolvedLanguage.replace("_", "-")).toLocaleString(DateTime.DATETIME_MED)
  : null;

  const tooltipIsEmpty = confidencePercentageLabel === null && dateTimeLabel === null;
  const tooltipLabel = () => {
    if (tooltipIsEmpty) {
      return null;
    }
    return (<div>
      {confidencePercentageLabel}
      <div>
        {dateTimeLabel}
      </div>
    </div>);
  };

  return (
    <Tooltip
      opened={tooltipOpened && !tooltipIsEmpty}
      label={tooltipLabel()}
      position="bottom"
      withArrow
    >
      {children}
    </Tooltip>
  );
}