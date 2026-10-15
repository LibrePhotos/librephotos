import type { UpgradeTask } from "@librephotos/api-client";
import { Badge } from "@mantine/core";
import { IconListCheck as ListCheck } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  isOpenTask,
  useDismissUpgradeTaskMutation,
  useStartUpgradeTaskMutation,
} from "../../api_client/jobs/hooks/useUpgradeTasks";
import { useJobQueue } from "../../hooks/useJobQueue";
import { NoticeCard } from "../common/NoticeCard";
import { UpgradeTaskRow } from "./UpgradeTaskRow";
import classes from "./UpgradeTaskRow.module.css";

/**
 * The Admin page's Finish the upgrade card (#2322): what the last update left for this instance to
 * do. Automatic tasks run by themselves and show their progress; optional ones wait for Start or
 * Not now; a failed one offers Retry. Finished tasks say Done for a day, then the card goes.
 */
export function FinishUpgradeCard({ tasks }: Readonly<{ tasks: UpgradeTask[] }>) {
  const { t } = useTranslation();
  const queue = useJobQueue();
  const start = useStartUpgradeTaskMutation();
  const dismiss = useDismissUpgradeTaskMutation();
  const open = tasks.filter(isOpenTask).length;
  const busyReason = queue.busy ? t("jobs.queuebusy.reason") : null;

  return (
    <NoticeCard
      color="orange"
      icon={<ListCheck size={20} />}
      title={open ? t("upgradetasks.header") : t("upgradetasks.finishedheader")}
      badge={
        open ? (
          <Badge color="orange" variant="light">
            {t("upgradetasks.left", { count: open })}
          </Badge>
        ) : null
      }
      description={open ? t("upgradetasks.intro") : t("upgradetasks.finishedintro")}
    >
      <ul className={classes.list}>
        {tasks.map(task => (
          <UpgradeTaskRow
            key={task.key}
            task={task}
            busyReason={busyReason}
            starting={start.isPending && start.variables === task.key}
            onStart={key => start.mutate(key)}
            onDismiss={key => dismiss.mutate(key)}
          />
        ))}
      </ul>
    </NoticeCard>
  );
}
