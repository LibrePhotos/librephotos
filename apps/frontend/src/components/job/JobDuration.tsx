import { Table } from "@mantine/core";
import { DateTime, Duration } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { i18nResolvedLanguage } from "../../i18n";

type IJobDuration = Readonly<{
  matches: boolean;
  finished: boolean;
  finishedAt: string | null;
  startedAt: string | null;
}>;

/**
 * Human duration of a job, up to now while it is still running. Sub-second
 * jobs keep their milliseconds; longer ones are rounded to whole seconds so
 * they read "2 min, 58 sec" instead of listing milliseconds as well.
 */
export function formatJobDuration(startedAt: string, finishedAt?: string | null): string {
  const end = finishedAt ? DateTime.fromISO(finishedAt) : DateTime.now();
  const ms = Math.max(0, end.diff(DateTime.fromISO(startedAt)).as("milliseconds"));
  const locale = i18nResolvedLanguage();
  const duration =
    ms < 1000
      ? Duration.fromObject({ milliseconds: Math.round(ms) }, { locale })
      : Duration.fromObject({ seconds: Math.round(ms / 1000) }, { locale }).rescale();
  return duration.toHuman({ unitDisplay: "short" });
}

export function JobDuration({ matches, finished, finishedAt, startedAt }: IJobDuration): JSX.Element | null {
  const { t } = useTranslation();

  // The Duration column only exists on wide screens. A cell here on a phone
  // pushed every later cell one column to the right.
  if (!matches) {
    return null;
  }
  if (finished) {
    // A job cancelled before it started has no duration.
    return <Table.Td>{startedAt && finishedAt ? formatJobDuration(startedAt, finishedAt) : null}</Table.Td>;
  }
  return <Table.Td>{startedAt ? t("joblist.running") : t("joblist.waiting")}</Table.Td>;
}
