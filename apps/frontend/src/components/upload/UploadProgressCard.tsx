import { ActionIcon, Badge, Box, Button, Group, Loader, Paper, Progress, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconPhoto,
  IconRotateClockwise,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FOOTER_HEIGHT } from "../../ui-constants";
import { useUpload } from "./UploadContext";
import type { UploadItem, UploadStatus } from "./useUploadQueue";

const STATUS_COLOR: Record<UploadStatus, string> = {
  pending: "gray",
  hashing: "gray",
  uploading: "blue",
  done: "green",
  duplicate: "gray",
  error: "red",
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
  return (
    <Badge
      color={STATUS_COLOR[status]}
      variant={status === "duplicate" ? "outline" : "light"}
      leftSection={icon}
      style={{ flexShrink: 0 }}
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
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <FileIcon size={16} style={{ flexShrink: 0, opacity: 0.6 }} />
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

/**
 * Floating, bottom-right progress card. Visible whenever there are queued or
 * finished uploads; collapsible, and dismissible once the queue is idle.
 */
export function UploadProgressCard() {
  const { t } = useTranslation();
  const { items, isUploading, retry, reset } = useUpload();
  const [collapsed, setCollapsed] = useState(false);

  const summary = useMemo(() => {
    const total = items.length;
    const duplicates = items.filter(i => i.status === "duplicate").length;
    const errors = items.filter(i => i.status === "error").length;
    const finished = items.filter(i => isFinished(i.status)).length;
    const bytes = items.reduce((acc, i) => acc + i.file.size, 0);
    const sentBytes = items.reduce((acc, i) => acc + i.file.size * (isFinished(i.status) ? 1 : i.progress / 100), 0);
    const ratio = bytes > 0 ? sentBytes / bytes : total > 0 ? finished / total : 0;
    return { total, duplicates, errors, finished, pct: Math.round(ratio * 100) };
  }, [items]);

  if (items.length === 0) return null;

  const closeLabel = isUploading ? t("upload.still_running") : t("upload.close");

  return (
    <Paper
      pos="fixed"
      right={16}
      bottom={{ base: FOOTER_HEIGHT + 16, sm: 16 }}
      w="min(92vw, 360px)"
      shadow="xl"
      radius="md"
      withBorder
      style={{ zIndex: 150, overflow: "hidden" }}
      data-testid="upload-progress-card"
    >
      <Group
        justify="space-between"
        wrap="nowrap"
        gap="xs"
        px="md"
        py="sm"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="sm" fw={600}>
            {isUploading ? t("upload.uploading") : t("upload.complete")}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {t("upload.processed", { finished: summary.finished, total: summary.total })}
            {summary.duplicates > 0 && ` · ${t("upload.duplicates", { count: summary.duplicates })}`}
            {summary.errors > 0 && ` · ${t("upload.errors", { count: summary.errors })}`}
          </Text>
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? t("upload.expand") : t("upload.collapse")}
          >
            {collapsed ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </ActionIcon>
          <Tooltip label={closeLabel}>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={reset}
              disabled={isUploading}
              aria-label={closeLabel}
              data-testid="upload-close"
            >
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Progress value={summary.pct} size="sm" radius={0} aria-label={t("upload.uploading")} />

      {!isUploading && summary.errors > 0 && (
        <Group px="md" pt="sm">
          <Button
            fullWidth
            variant="default"
            size="xs"
            leftSection={<IconRotateClockwise size={14} />}
            onClick={() => retry(items)}
            data-testid="upload-retry-all"
          >
            {t("upload.retry_failed", { count: summary.errors })}
          </Button>
        </Group>
      )}

      {!collapsed && (
        <Box mah={256} style={{ overflowY: "auto" }}>
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
