import type { UpgradeTask } from "@librephotos/api-client";
import { Anchor, Badge, Box, Button, Group, Progress, Stack, Text, VisuallyHidden } from "@mantine/core";
import {
  IconCircleCheck as CircleCheck,
  IconCircleDashed as CircleDashed,
  IconCircleX as CircleX,
  IconClock as Clock,
  IconLoader2 as Loader2,
  IconRefresh as Refresh,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { parseInstant } from "../../util/dateUtils";
import { formatCount, formatPercent } from "../../util/formatCount";
import { DisabledReason } from "../common/DisabledReason";
import classes from "./UpgradeTaskRow.module.css";
import { upgradeTaskDescription, upgradeTaskTitle } from "./upgradeTaskText";

const STATUS_ICON_SIZE = 20;

function StatusIcon({ task }: Readonly<{ task: UpgradeTask }>) {
  switch (task.status) {
    case "running":
      return <Loader2 size={STATUS_ICON_SIZE} className={classes.spin} color="var(--mantine-color-blue-filled)" />;
    case "failed":
      return <CircleX size={STATUS_ICON_SIZE} color="var(--mantine-color-red-filled)" />;
    case "done":
      return <CircleCheck size={STATUS_ICON_SIZE} color="var(--mantine-color-green-filled)" />;
    case "pending":
      return task.optional ? (
        <CircleDashed size={STATUS_ICON_SIZE} color="var(--mantine-color-dimmed)" />
      ) : (
        <Clock size={STATUS_ICON_SIZE} color="var(--mantine-color-dimmed)" />
      );
  }
}

/** The mark before the title; the status is also there in words for screen readers. */
function StatusMark({ task }: Readonly<{ task: UpgradeTask }>) {
  const { t } = useTranslation();
  return (
    <Box className={classes.status}>
      <Box aria-hidden display="contents">
        <StatusIcon task={task} />
      </Box>
      <VisuallyHidden>{t(`upgradetasks.status.${task.status}`)}</VisuallyHidden>
    </Box>
  );
}

function JobLink({ id }: Readonly<{ id: number | null }>) {
  const { t } = useTranslation();
  if (id === null) return null;
  return (
    <Anchor size="xs" renderRoot={props => <Link to="/admin/job/$id" params={{ id: String(id) }} {...props} />}>
      {t("upgradetasks.viewjob")}
    </Anchor>
  );
}

function RunningLine({ task }: Readonly<{ task: UpgradeTask }>) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const done = task.progress_current ?? 0;
  const total = task.progress_target ?? 0;
  if (total === 0) {
    // Queued behind another job, or not counted its items yet.
    return (
      <Group gap="xs">
        <Text size="xs" c="dimmed">
          {t("upgradetasks.waiting")}
        </Text>
        <JobLink id={task.latest_job_id} />
      </Group>
    );
  }
  const fraction = Math.min(done / total, 1);
  return (
    <Stack gap={4} maw={360}>
      <Progress size="sm" value={fraction * 100} aria-label={upgradeTaskTitle(task, t)} />
      <Group gap="xs">
        <Text size="xs" c="dimmed">
          {t("upgradetasks.progress", {
            done: formatCount(done, locale),
            total: formatCount(total, locale),
            percent: formatPercent(fraction, locale, 0),
          })}
        </Text>
        <JobLink id={task.latest_job_id} />
      </Group>
    </Stack>
  );
}

/** Under the sentence: how far it got, why it stopped, when it finished, or why it cannot start. */
function StatusLine({ task, busyReason }: Readonly<{ task: UpgradeTask; busyReason: string | null }>) {
  const { t } = useTranslation();
  switch (task.status) {
    case "running":
      return <RunningLine task={task} />;
    case "done":
      return (
        <Text size="xs" c="dimmed">
          {t("upgradetasks.done", { when: task.completed_at ? parseInstant(task.completed_at).toRelative() : "" })}
        </Text>
      );
    case "failed":
      return (
        <Group gap="xs">
          <Text size="xs" c="red">
            {task.error ? t("upgradetasks.failed", { error: task.error }) : t("upgradetasks.failednoreason")}
          </Text>
          <JobLink id={task.latest_job_id} />
        </Group>
      );
    case "pending":
      if (busyReason) {
        return (
          <Text size="xs" c="orange">
            {busyReason}
          </Text>
        );
      }
      return task.optional ? null : (
        <Text size="xs" c="dimmed">
          {t("upgradetasks.notstarted")}
        </Text>
      );
  }
}

type UpgradeTaskRowProps = Readonly<{
  task: UpgradeTask;
  /** Why Start cannot be used now (another job runs); null when it can. */
  busyReason: string | null;
  starting: boolean;
  onStart: (key: string) => void;
  onDismiss: (key: string) => void;
}>;

/** Start or Retry while the task waits or failed; Not now for an optional one. */
function RowActions({ task, busyReason, starting, onStart, onDismiss }: UpgradeTaskRowProps) {
  const { t } = useTranslation();
  if (task.status === "running" || task.status === "done") return null;
  const failed = task.status === "failed";
  return (
    <Group gap="xs" wrap="nowrap" ml="auto">
      {task.optional ? (
        <Button variant="subtle" color="gray" size="xs" onClick={() => onDismiss(task.key)}>
          {t("upgradetasks.notnow")}
        </Button>
      ) : null}
      <DisabledReason reason={busyReason}>
        <Button
          size="xs"
          variant={failed ? "default" : "filled"}
          leftSection={failed ? <Refresh size={14} /> : undefined}
          loading={starting}
          onClick={() => onStart(task.key)}
        >
          {failed ? t("upgradetasks.retry") : t("upgradetasks.start")}
        </Button>
      </DisabledReason>
    </Group>
  );
}

/**
 * One task of the Finish the upgrade card (#2322): its status, title, kind and one sentence, what it
 * is doing now, and its buttons. While another job runs, Start says why it waits.
 */
export function UpgradeTaskRow(props: UpgradeTaskRowProps) {
  const { t } = useTranslation();
  const { task, busyReason } = props;
  return (
    <Group component="li" className={classes.row} align="flex-start" gap="sm" wrap="wrap">
      <StatusMark task={task} />
      <Stack gap={4} flex="1 1 240px" miw={0}>
        <Group gap="xs">
          <Text size="sm" fw={600} c={task.status === "done" ? "dimmed" : undefined}>
            {upgradeTaskTitle(task, t)}
          </Text>
          <Badge size="xs" color="gray" variant={task.optional ? "outline" : "light"}>
            {task.optional ? t("upgradetasks.optional") : t("upgradetasks.automatic")}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed">
          {upgradeTaskDescription(task, t)}
        </Text>
        <StatusLine task={task} busyReason={busyReason} />
      </Stack>
      <RowActions {...props} />
    </Group>
  );
}
