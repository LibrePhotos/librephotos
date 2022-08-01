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
        <Progress size={30} value={(+current.toFixed(2) / target) * 100} />
        <Center>
          {`${current} ${t("joblist.itemsprocessed")} (${((+current.toFixed(2) / target) * 100).toFixed(2)} %) `}
        </Center>
      </div>
    );
  }
  if (finished) {
    return (
      <div>
        <Progress size={30} color={error ? "red" : "green"} value={100} />
        <Center>{`${current} ${t("joblist.itemsprocessed")} `}</Center>
      </div>
    );
  }
  return null;
}
