import { Anchor, Box, Button, Group, Progress, Stack, Text } from "@mantine/core";
import { IconCircleCheck as CircleCheck } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { formatCount } from "../../util/formatCount";
import { DisabledReason } from "../common/DisabledReason";
import { isStageDone, STAGE_ICONS } from "./processingStages";
import type { KnownStage } from "./processingStages";
import classes from "./ProcessingStatusCard.module.css";

type StageProps = Readonly<{ stage: KnownStage }>;

/** The stage's name, as the rows and the Run now buttons' names say it. */
function stageTitle(stage: KnownStage, t: TFunction): string {
  return t(`processingstatus.stage.${stage.key}.title`);
}

function JobListLink({ children, color }: Readonly<{ children: React.ReactNode; color?: string }>) {
  return (
    <Anchor size="xs" c={color} renderRoot={props => <Link to="/jobs" {...props} />}>
      {children}
    </Anchor>
  );
}

/** A running stage: its job's progress in place of the count. */
function RunningProgress({ stage, job }: Readonly<{ stage: KnownStage; job: NonNullable<KnownStage["running_job"]> }>) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  if (job.progress_target === 0) {
    // Queued behind another job, or not counted its items yet.
    return (
      <Text size="xs" c="blue">
        {t("processingstatus.starting")}
      </Text>
    );
  }
  const done = formatCount(job.progress_current, locale);
  const total = formatCount(job.progress_target, locale);
  return (
    <Stack gap={2} className={classes.progress}>
      <Text size="xs" c="blue">
        {t("processingstatus.running", { done, total })}
      </Text>
      {/* The counts, not Mantine's percentage, are what a screen reader hears. */}
      <Progress.Root size="sm">
        <Progress.Section
          value={Math.min(job.progress_current / job.progress_target, 1) * 100}
          withAria={false}
          role="progressbar"
          aria-label={stageTitle(stage, t)}
          aria-valuemin={0}
          aria-valuemax={job.progress_target}
          aria-valuenow={job.progress_current}
          aria-valuetext={t("processingstatus.progressvalue", { done, total })}
        />
      </Progress.Root>
    </Stack>
  );
}

/** What is left in words, or Done. */
function RemainingCount({ stage }: StageProps) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  if (stage.remaining === 0) {
    return (
      <Group gap={4} wrap="nowrap" c="green">
        <CircleCheck size={16} aria-hidden />
        <Text size="sm">{t("processingstatus.done")}</Text>
      </Group>
    );
  }
  return (
    <Text size="sm" fw={600}>
      {t(`processingstatus.stage.${stage.key}.left`, {
        count: stage.remaining,
        formatted: formatCount(stage.remaining, locale),
      })}
    </Text>
  );
}

/** The failures of the stage's last run, linked to the job list; nothing while it runs or after a clean run. */
function LastRunFailures({ stage }: StageProps) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const run = stage.last_run;
  if (run === null || stage.running_job !== null) return null;
  if (run.error_count > 0) {
    return (
      <JobListLink color="red">
        {t("processingstatus.failedcount", {
          count: run.error_count,
          formatted: formatCount(run.error_count, locale),
        })}
      </JobListLink>
    );
  }
  return run.failed ? <JobListLink color="red">{t("processingstatus.lastrunfailed")}</JobListLink> : null;
}

type RowActionProps = Readonly<{
  stage: KnownStage;
  /** Why Run now cannot be used (a job runs); null when it can. */
  busyReason: string | null;
  starting: boolean;
  onRun: (stage: KnownStage) => void;
}>;

/** Run now while work is left; View job while the stage's job runs. */
function RowAction({ stage, busyReason, starting, onRun }: RowActionProps) {
  const { t } = useTranslation();
  if (stage.running_job !== null) {
    return <JobListLink>{t("processingstatus.viewjob")}</JobListLink>;
  }
  if (isStageDone(stage)) return null;
  return (
    <DisabledReason reason={busyReason}>
      <Button
        size="xs"
        variant="default"
        loading={starting}
        onClick={() => onRun(stage)}
        aria-label={t("processingstatus.runnowlabel", { stage: stageTitle(stage, t) })}
      >
        {t("processingstatus.runnow")}
      </Button>
    </DisabledReason>
  );
}

type ProcessingStageRowProps = RowActionProps &
  Readonly<{
    /** Say that older uploads without faces count as not checked (#2741): upload-only libraries. */
    showUploadNote: boolean;
  }>;

/**
 * One stage of the Processing status card (#2741): its name and meaning, what is left (or its
 * job's progress while it runs), the failures of its last run, and Run now.
 */
export function ProcessingStageRow({ showUploadNote, ...action }: ProcessingStageRowProps) {
  const { t } = useTranslation();
  const { stage } = action;
  const StageIcon = STAGE_ICONS[stage.key];
  return (
    <li className={classes.row}>
      <Box className={classes.icon} aria-hidden>
        <StageIcon size={20} />
      </Box>
      <Stack gap={0} className={classes.text}>
        <Text size="sm" fw={500}>
          {stageTitle(stage, t)}
        </Text>
        <Text size="xs" c="dimmed">
          {showUploadNote ? t("processingstatus.uploadfacenote") : t(`processingstatus.stage.${stage.key}.description`)}
        </Text>
      </Stack>
      <Box className={classes.status}>
        {stage.running_job === null ? (
          <RemainingCount stage={stage} />
        ) : (
          <RunningProgress stage={stage} job={stage.running_job} />
        )}
        <LastRunFailures stage={stage} />
      </Box>
      <Box className={classes.action}>
        <RowAction {...action} />
      </Box>
    </li>
  );
}
