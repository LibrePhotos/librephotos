import type { ProcessingStatus } from "@librephotos/api-client";
import { Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronDown as ChevronDown, IconCircleCheck as CircleCheck } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  useProcessingStatusQuery,
  useRetryUnmatchedFacesMutation,
  useRunProcessingStageMutation,
} from "../../api_client/jobs/hooks";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { useJobQueue } from "../../hooks/useJobQueue";
import { formatCount } from "../../util/formatCount";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { ProcessingStageRow } from "./ProcessingStageRow";
import { isStageDone, knownStages } from "./processingStages";
import type { KnownStage } from "./processingStages";
import classes from "./ProcessingStatusCard.module.css";

type ProcessingStatusCardProps = Readonly<{
  /** Why Run now cannot be used: a job is running. Undefined while the queue takes jobs. */
  busyReason?: string;
  /** The user has no scan directory: their photos come from uploads only. */
  uploadOnly: boolean;
}>;

type AllDoneLineProps = Readonly<{
  photoCount: number;
  /** Faces the face model found no face in (#2888): said here too, Try again is in the details. */
  unmatchedFaces: number;
  onShow: () => void;
}>;

/** One green line when every stage is done; Show details opens the rows. */
function AllDoneLine({ photoCount, unmatchedFaces, onShow }: AllDoneLineProps) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  return (
    <Group gap="xs" wrap="wrap" justify="space-between">
      <Group gap="sm" wrap="nowrap" flex="1 1 220px">
        <CircleCheck size={20} color="var(--mantine-color-green-filled)" aria-hidden />
        <Stack gap={0}>
          <Text size="sm" fw={500}>
            {t("processingstatus.alldone", { count: photoCount, formatted: formatCount(photoCount, locale) })}
          </Text>
          <Text size="xs" c="dimmed">
            {t("processingstatus.alldonedescription")}
          </Text>
          {unmatchedFaces > 0 && (
            <Text size="xs" c="dimmed">
              {t("processingstatus.unmatched", {
                count: unmatchedFaces,
                formatted: formatCount(unmatchedFaces, locale),
              })}
            </Text>
          )}
        </Stack>
      </Group>
      <Button variant="subtle" size="xs" rightSection={<ChevronDown size={14} />} onClick={onShow} ml="auto">
        {t("processingstatus.showdetails")}
      </Button>
    </Group>
  );
}

type StageListProps = Readonly<{
  stages: KnownStage[];
  busyReason?: string;
  uploadOnly: boolean;
}>;

/** The rows, each with its Run now; a click starts that stage's job. */
function StageList({ stages, busyReason, uploadOnly }: StageListProps) {
  const run = useRunProcessingStageMutation();
  const retry = useRetryUnmatchedFacesMutation();
  return (
    <ul className={classes.list}>
      {stages.map(stage => (
        <ProcessingStageRow
          key={stage.key}
          stage={stage}
          busyReason={busyReason ?? null}
          starting={run.isPending && run.variables === stage.key}
          onRun={({ key }) => run.mutate(key)}
          showUploadNote={uploadOnly && stage.key === "face_detection" && stage.remaining > 0}
          retrying={retry.isPending}
          onRetry={() => retry.mutate()}
        />
      ))}
    </ul>
  );
}

type StatusBodyProps = Readonly<{
  status: ProcessingStatus;
  busyReason?: string;
  uploadOnly: boolean;
}>;

/** The rows under the card's title, or the green line when all is done. */
function StatusBody({ status, busyReason, uploadOnly }: StatusBodyProps) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const [expanded, { open, close }] = useDisclosure(false);
  const stages = knownStages(status.stages);
  const allDone = stages.every(isStageDone);
  const count = status.photo_count;
  if (allDone && !expanded) {
    const unmatchedFaces = stages.reduce((total, stage) => total + stage.unmatched, 0);
    return <AllDoneLine photoCount={count} unmatchedFaces={unmatchedFaces} onShow={open} />;
  }
  return (
    <>
      <Text size="sm" c="dimmed">
        {t("processingstatus.intro", { count, formatted: formatCount(count, locale) })}
      </Text>
      <StageList stages={stages} busyReason={busyReason} uploadOnly={uploadOnly} />
      {allDone && (
        <Button variant="subtle" size="xs" onClick={close} mr="auto">
          {t("processingstatus.hidedetails")}
        </Button>
      )}
    </>
  );
}

/** The title, and once the status is in, how many stages are done. */
function CardHeader({ status }: Readonly<{ status: ProcessingStatus | undefined }>) {
  const { t } = useTranslation();
  const stages = status ? knownStages(status.stages) : [];
  return (
    <Group justify="space-between" gap="xs">
      <Title order={4}>{t("processingstatus.title")}</Title>
      {status && (
        <Text size="sm" c="dimmed">
          {t("processingstatus.stagesdone", { done: stages.filter(isStageDone).length, total: stages.length })}
        </Text>
      )}
    </Group>
  );
}

/**
 * The Library page's Processing status card (#2741): one row per processing stage that is turned
 * on, with what is left of the user's library and Run now. A running stage shows its progress, a
 * stage whose last run failed items says how many. When every stage is done the card is one green
 * line. Nothing for a library without photos: the scan comes first.
 */
export function ProcessingStatusCard({ busyReason, uploadOnly }: ProcessingStatusCardProps) {
  const { t } = useTranslation();
  const queue = useJobQueue();
  const query = useProcessingStatusQuery(queue.busy);
  const failure = useListFailure(query);
  const { data } = query;
  if (data?.photo_count === 0) return null;
  let body: React.ReactNode = <PageLoader />;
  if (failure) {
    body = <ErrorState failure={failure} compact />;
  } else if (data) {
    body = <StatusBody status={data} busyReason={busyReason} uploadOnly={uploadOnly} />;
  }
  return (
    <Card shadow="md" component="section" aria-label={t("processingstatus.title")}>
      <Stack gap="sm">
        <CardHeader status={data} />
        {body}
      </Stack>
    </Card>
  );
}
