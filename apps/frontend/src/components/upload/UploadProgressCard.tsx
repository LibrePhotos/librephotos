import { ActionIcon, Badge, Box, Button, Group, Loader, Paper, Progress, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconAlertCircle,
  IconBan,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconPhoto,
  IconPlayerStop,
  IconRotateClockwise,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FOOTER_HEIGHT } from "../../uiConstants";
import { useUpload } from "./UploadContext";
import classes from "./UploadProgressCard.module.css";
import type { UploadItem, UploadStatus } from "./useUploadQueue";

const STATUS_COLOR: Record<UploadStatus, string> = {
  pending: "gray",
  hashing: "gray",
  uploading: "blue",
  done: "green",
  duplicate: "gray",
  error: "red",
  cancelled: "gray",
};

const isFinished = (status: UploadStatus) => status === "done" || status === "duplicate" || status === "error";
const isBusy = (status: UploadStatus) => status === "hashing" || status === "uploading";

function StatusBadge({ status }: { status: UploadStatus }) {
  const { t } = useTranslation();
  let icon: React.ReactNode = null;
  if (isBusy(status)) icon = <Loader size={10} color={STATUS_COLOR[status]} />;
  if (status === "done") icon = <IconCheck size={12} />;
  if (status === "duplicate") icon = <IconCopy size={12} />;
  if (status === "error") icon = <IconAlertCircle size={12} />;
  if (status === "cancelled") icon = <IconBan size={12} />;
  return (
    <Badge
      color={STATUS_COLOR[status]}
      variant={status === "duplicate" ? "outline" : "light"}
      leftSection={icon}
      className={classes.noShrink}
    >
      {t(`upload.status.${status}`)}
    </Badge>
  );
}

function UploadRow({ item, onRetry }: { item: UploadItem; onRetry: (item: UploadItem) => void }) {
  const { t } = useTranslation();
  const FileIcon = item.file.type.startsWith("video/") ? IconVideo : IconPhoto;
  return (
    <Paper withBorder radius="sm" px="sm" py={6} data-testid="upload-row">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="xs" wrap="nowrap" miw="0">
          <FileIcon size={16} className={classes.fileIcon} />
          <Text size="sm" truncate title={item.file.name}>
            {item.file.name}
          </Text>
        </Group>
        <StatusBadge status={item.status} />
      </Group>
      {item.status === "uploading" && <Progress value={item.progress} size="xs" mt={6} />}
      {item.status === "error" && (
        <Stack gap={4} mt={6} align="flex-start">
          <Text size="xs" c="red" lh={1.3}>
            {item.error || t("upload.unknown_error")}
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconRotateClockwise size={12} />}
            onClick={() => onRetry(item)}
          >
            {t("upload.retry")}
          </Button>
        </Stack>
      )}
    </Paper>
  );
}

type Summary = {
  total: number;
  duplicates: number;
  errors: number;
  cancelled: number;
  finished: number;
  pct: number;
};

function summarise(items: UploadItem[]): Summary {
  const count = (status: UploadStatus) => items.filter(i => i.status === status).length;
  const total = items.length;
  const finished = items.filter(i => isFinished(i.status)).length;
  const bytes = items.reduce((acc, i) => acc + i.file.size, 0);
  const sentBytes = items.reduce((acc, i) => acc + i.file.size * (isFinished(i.status) ? 1 : i.progress / 100), 0);
  const ratio = bytes > 0 ? sentBytes / bytes : total > 0 ? finished / total : 0;
  return {
    total,
    duplicates: count("duplicate"),
    errors: count("error"),
    cancelled: count("cancelled"),
    finished,
    pct: Math.round(ratio * 100),
  };
}

function useCardTitle(isUploading: boolean, isCancelling: boolean, cancelled: number): string {
  const { t } = useTranslation();
  if (isCancelling) return t("upload.cancelling");
  if (isUploading) return t("upload.uploading");
  return cancelled > 0 ? t("upload.cancelled") : t("upload.complete");
}

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
    <Tooltip label={t("upload.cancel_hint")}>
      <Button
        size="compact-sm"
        variant="subtle"
        color="red"
        leftSection={<IconPlayerStop size={14} />}
        onClick={cancel}
        disabled={isCancelling}
        data-testid="upload-cancel"
      >
        {t("upload.cancel")}
      </Button>
    </Tooltip>
  );
}

/**
 * Floating, bottom-right progress card. Visible whenever there are queued or
 * finished uploads; collapsible, cancellable while running and dismissible once
 * the queue is idle.
 */
export function UploadProgressCard() {
  const { t } = useTranslation();
  const { items, isUploading, isCancelling, retry } = useUpload();
  const [collapsed, setCollapsed] = useState(false);

  const summary = useMemo(() => summarise(items), [items]);
  const title = useCardTitle(isUploading, isCancelling, summary.cancelled);

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
        {/* Announces "Upload cancelled" and the counts to screen readers as they change. */}
        <Stack gap={0} miw="0" aria-live="polite">
          <Text size="sm" fw={600}>
            {title}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {t("upload.processed", { finished: summary.finished, total: summary.total })}
            {summary.duplicates > 0 && ` · ${t("upload.duplicates", { count: summary.duplicates })}`}
            {summary.errors > 0 && ` · ${t("upload.errors", { count: summary.errors })}`}
            {summary.cancelled > 0 && ` · ${t("upload.cancelled_count", { count: summary.cancelled })}`}
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

      <Progress
        value={summary.pct}
        size="sm"
        radius={0}
        color={!isUploading && summary.cancelled > 0 ? "gray" : undefined}
        aria-label={t("upload.uploading")}
      />

      {!isUploading && summary.errors + summary.cancelled > 0 && (
        <RetryAllButton summary={summary} onRetry={() => retry(items)} />
      )}

      {!collapsed && (
        <Box mah={256} className={classes.rows}>
          <Stack gap="xs" p="sm">
            {items.map(item => (
              <UploadRow key={item.id} item={item} onRetry={it => retry([it])} />
            ))}
          </Stack>
        </Box>
      )}
    </Paper>
  );
}
