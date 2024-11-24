import { Table } from "@mantine/core";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";

import { i18nResolvedLanguage } from "../../i18n";

type IJobDuration = Readonly<{
  matches: boolean;
  finished: boolean;
  finishedAt: string | null;
  startedAt: string | null;
}>;

export function JobDuration({ matches, finished, finishedAt, startedAt }: IJobDuration): JSX.Element | null {
  const { t } = useTranslation();

  if (matches) {
    if (finished && finishedAt && startedAt) {
      return (
        <Table.Td>
          {DateTime.fromISO(finishedAt)
            .diff(DateTime.fromISO(startedAt))
            .reconfigure({ locale: i18nResolvedLanguage() })
            .rescale()
            .toHuman()}
        </Table.Td>
      );
    }
    if (startedAt) {
      return <Table.Td>{t("joblist.running")}</Table.Td>;
    }
  }

  return <Table.Td>{t("joblist.waiting")}</Table.Td>;
}
