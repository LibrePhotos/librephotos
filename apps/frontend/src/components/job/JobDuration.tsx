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
        <td>
          {DateTime.fromISO(finishedAt)
            .diff(DateTime.fromISO(startedAt))
            .reconfigure({ locale: i18nResolvedLanguage() })
            .rescale()
            .toHuman()}
        </td>
      );
    }
    if (startedAt) {
      return <td>{t("joblist.running")}</td>;
    }
  }

  return <td>{t("joblist.waiting")}</td>;
}
