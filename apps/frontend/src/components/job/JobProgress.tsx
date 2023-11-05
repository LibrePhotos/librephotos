import { Center, Progress } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

interface IJobProgress {
  target?: number;
  current?: number;
  finished: boolean;
  error: unknown;
}

export function JobProgress({ target, current, finished, error }: IJobProgress) {
  const { t } = useTranslation();

  if (target && current && target !== 0 && !finished) {
    return (
      <div>
        <Progress size={10} value={(+current.toFixed(2) / target) * 100} />
        <Center>
          {`${current} ${t("joblist.itemsadded")} (${((+current.toFixed(2) / target) * 100).toFixed(2)} %) `}
        </Center>
      </div>
    );
  }
  if (finished) {
    return (
      <div>
        <Progress size={10} color={error ? "red" : "green"} value={100} />
        <Center>{`${current} ${t("joblist.itemsadded")} `}</Center>
      </div>
    );
  }
  return null;
}

JobProgress.defaultProps = {
  target: 0,
  current: 0,
};
