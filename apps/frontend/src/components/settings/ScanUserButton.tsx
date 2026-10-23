import { ActionIcon, Badge } from "@mantine/core";
import { IconRefresh as Refresh } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useScanUserPhotosMutation } from "../../api_client/jobs/hooks/useScanUserPhotosMutation";
import { useWorkerStatus } from "../../hooks/useWorkerStatus";
import { jobPercent } from "../menubars/WorkerJobMenuSection";

/** The scan job type (`LongRunningJob.JOB_SCAN_PHOTOS`). */
const JOB_SCAN_PHOTOS = 1;

type Props = Readonly<{ userId: number; username: string }>;

/**
 * Scan now, next to a user's folder in the Admin Area (#2037). While the worker runs a scan of
 * this user, the button gives way to its progress.
 */
export function ScanUserButton({ userId, username }: Props) {
  const { t } = useTranslation();
  const { mutate: scan, isPending } = useScanUserPhotosMutation();
  const { workerRunningJob } = useWorkerStatus();
  const scanning =
    workerRunningJob !== null &&
    !workerRunningJob.finished &&
    workerRunningJob.job_type === JOB_SCAN_PHOTOS &&
    workerRunningJob.started_by.id === userId;

  if (scanning) {
    const percent = jobPercent(workerRunningJob);
    return (
      <Badge size="sm" variant="light" leftSection={<Refresh size={12} />}>
        {percent === null ? t("adminarea.scanning") : t("adminarea.scanningpercent", { percent: Math.round(percent) })}
      </Badge>
    );
  }
  const label = t("adminarea.scannow", { username });
  return (
    <ActionIcon
      variant="subtle"
      size="sm"
      title={label}
      aria-label={label}
      loading={isPending}
      onClick={() => scan({ userId, username })}
    >
      <Refresh size={16} />
    </ActionIcon>
  );
}
