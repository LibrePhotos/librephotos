import moment from "moment";
import React from "react";
import { useTranslation } from "react-i18next";

interface IJobDuration {
  matches: boolean;
  finished: boolean;
  finishedAt: string | null;
  startedAt: string | null;
}

export function JobDuration({ matches, finished, finishedAt, startedAt }: IJobDuration): JSX.Element | null {
  const { t } = useTranslation();

  if (matches) {
    if (finished) {
      return <td>{moment.duration(+moment(finishedAt) - +moment(startedAt)).humanize()}</td>;
    }
    if (startedAt) {
      return <td>{t("joblist.running")}</td>;
    }
  }

  return null;
}
