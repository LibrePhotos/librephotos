import { ActionIcon, Box, Button, Group, Paper, Progress, Stack, Text, Tooltip } from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconPlayerStop, IconRotateClockwise, IconX } from "@tabler/icons-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FOOTER_HEIGHT } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { UploadAlbumStrip } from "./UploadAlbumStrip";
import { useOptionalUploadProcessing, useUpload } from "./UploadContext";
import { NO_OUTCOMES, rowServerState } from "./uploadProcessing";
import classes from "./UploadProgressCard.module.css";
import { UploadRow } from "./UploadRow";
import { cardStage, summarise, useCardHeading, type CardStage, type Summary } from "./useCardHeading";
import type { UploadProcessing } from "./useUploadProcessing";

const NOT_FOLLOWED: UploadProcessing = {
  phase: "untracked",
  outcomes: NO_OUTCOMES,
  counts: { ready: 0, total: 0 },
  stalledMinutes: null,
  openImports: [],
};

/** One button re-queues every failed and cancelled file; its label says which kind. */
function RetryAllButton({ summary, onRetry }: { summary: Summary; onRetry: () => void }) {
  const { t } = useTranslation();
  const count = summary.errors + summary.cancelled;
  let label = t("upload.retry_all", { count });
  if (summary.cancelled === 0) label = t("upload.retry_failed", { count });
  if (summary.errors === 0) label = t("upload.retry_cancelled", { count });
  return (
    <Group px="md" pt="sm">
      <Button
        fullWidth
        variant="default"
        size="xs"
        leftSection={<IconRotateClockwise size={14} />}
        onClick={onRetry}
        data-testid="upload-retry-all"
      >
        {label}
      </Button>
    </Group>
  );
}

/** While uploading: a labelled Cancel (no confirmation, cancelled files can be retried). Afterwards: close. */
function StopOrCloseButton() {
  const { t } = useTranslation();
  const { isUploading, isCancelling, cancel, reset } = useUpload();
  if (!isUploading) {
    return (
      <Tooltip label={t("upload.close")}>
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={reset}
          aria-label={t("upload.close")}
          data-testid="upload-close"
        >
          <IconX size={16} />
        </ActionIcon>
      </Tooltip>
    );
  }
  return (
    <DisabledReason label={t("upload.cancel_hint")} reason={isCancelling && t("upload.cancelling")}>
      <Button
        size="compact-sm"
        variant="subtle"
        color="red"
        leftSection={<IconPlayerStop size={14} />}
        onClick={cancel}
        data-testid="upload-cancel"
      >
        {t("upload.cancel")}
      </Button>
    </DisabledReason>
  );
}

/**
 * The card's bar: bytes sent while uploading; then, while the server processes the uploads, a
 * two-tone bar (green ready, blue uploaded and still processing); a moving full bar while the
 * search and face steps run; full green when done.
 */
function CardBar({ stage, summary, processing }: { stage: CardStage; summary: Summary; processing: UploadProcessing }) {
  const { t } = useTranslation();
  const { ready, total } = processing.counts;
  if (stage === "processing") {
    const readyPct = total > 0 ? (ready / total) * 100 : 0;
    return (
      <Progress.Root size="sm" radius={0} aria-label={t("upload.server.processing_title")}>
        <Progress.Section
          value={readyPct}
          color="green"
          aria-label={t("upload.server.ready_count", { ready, total })}
        />
        <Progress.Section value={100 - readyPct} color="blue" />
      </Progress.Root>
    );
  }
  if (stage === "followups" || stage === "done") {
    const busy = stage === "followups";
    return (
      <Progress
        value={100}
        size="sm"
        radius={0}
        color="green"
        striped={busy}
        animated={busy}
        aria-label={busy ? t("upload.server.followups_title") : t("upload.server.ready_count", { ready, total })}
      />
    );
  }
  return (
    <Progress
      value={summary.pct}
      size="sm"
      radius={0}
      color={stage === "untracked" && summary.cancelled > 0 ? "gray" : undefined}
      aria-label={t("upload.uploading")}
    />
  );
}

/** Said while the server makes no progress, so the card never spins without an explanation. */
function StallNote({ minutes }: { minutes: number | null }) {
  const { t } = useTranslation();
  if (minutes === null) return null;
  return (
    <Text size="xs" c="orange" px="md" pt="xs" lh={1.3} data-testid="upload-stalled">
      {t("upload.server.stalled", { count: minutes })}
    </Text>
  );
}

/**
 * Floating, bottom-right progress card. Visible whenever there are queued or
 * finished uploads; collapsible, cancellable while running and dismissible once
 * the queue is idle. After the upload it follows the server's import of the
 * files until they are ready (#2739).
 */
export function UploadProgressCard() {
  const { t } = useTranslation();
  const { items, isUploading, isCancelling, retry } = useUpload();
  const processing = useOptionalUploadProcessing() ?? NOT_FOLLOWED;
  const [collapsed, setCollapsed] = useState(false);

  const summary = useMemo(() => summarise(items), [items]);
  const stage = cardStage(isUploading, isCancelling, processing.phase);
  const { title, detail } = useCardHeading(stage, summary, processing);

  if (items.length === 0) return null;

  return (
    <Paper
      pos="fixed"
      right={16}
      bottom={{ base: FOOTER_HEIGHT + 16, sm: 16 }}
      w="min(92vw, 360px)"
      shadow="xl"
      radius="md"
      withBorder
      className={classes.card}
      data-testid="upload-progress-card"
    >
      <Group justify="space-between" wrap="nowrap" gap="xs" px="md" py="sm" className={classes.header}>
        <Stack gap={0} miw="0">
          {/* Announces each stage ("Upload cancelled", "Processing your uploads") to screen readers. */}
          <Text size="sm" fw={600} aria-live="polite">
            {title}
          </Text>
          {/* The counts too, except while the server processes: they would chatter every poll. */}
          <Text size="xs" c="dimmed" truncate aria-live={stage === "processing" ? "off" : "polite"}>
            {detail}
          </Text>
        </Stack>
        <Group gap={4} wrap="nowrap" className={classes.noShrink}>
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? t("upload.expand") : t("upload.collapse")}
          >
            {collapsed ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </ActionIcon>
          <StopOrCloseButton />
        </Group>
      </Group>

      <UploadAlbumStrip items={items} isUploading={isUploading} />

      <CardBar stage={stage} summary={summary} processing={processing} />

      <StallNote minutes={processing.stalledMinutes} />

      {!isUploading && summary.errors + summary.cancelled > 0 && (
        <RetryAllButton summary={summary} onRetry={() => retry(items)} />
      )}

      {!collapsed && (
        <Box mah={256} className={classes.rows}>
          <Stack gap="xs" p="sm">
            {items.map(item => (
              <UploadRow
                key={item.id}
                item={item}
                server={rowServerState(item, processing.outcomes)}
                onRetry={it => retry([it])}
              />
            ))}
          </Stack>
        </Box>
      )}
    </Paper>
  );
}
