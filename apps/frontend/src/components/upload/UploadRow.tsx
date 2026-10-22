import type { UploadFailedFile } from "@librephotos/api-client";
import { Anchor, Badge, Button, Group, Loader, Paper, Progress, Stack, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconBan,
  IconCheck,
  IconCopy,
  IconPhoto,
  IconRotateClockwise,
  IconVideo,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { ParseKeys, TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { MediaThumbnail } from "../common/MediaThumbnail";
import { AlbumOutcomeNote } from "./UploadAlbumStrip";
import type { RowServerState } from "./uploadProcessing";
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

const isBusy = (status: UploadStatus) => status === "hashing" || status === "uploading";

const STATUS_ICON: Partial<Record<UploadStatus, React.ReactNode>> = {
  done: <IconCheck size={12} />,
  duplicate: <IconCopy size={12} />,
  error: <IconAlertCircle size={12} />,
  cancelled: <IconBan size={12} />,
};

function StatusBadge({ status }: { status: UploadStatus }) {
  const { t } = useTranslation();
  const icon = isBusy(status) ? <Loader size={10} color={STATUS_COLOR[status]} /> : STATUS_ICON[status];
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

/** The badge of an uploaded file the server imports (#2739): Processing, Ready or Not imported. */
function ServerBadge({ state }: { state: Exclude<RowServerState, { kind: "untracked" }> }) {
  const { t } = useTranslation();
  if (state.kind === "processing") {
    return (
      <Badge color="blue" variant="light" leftSection={<Loader size={10} />} className={classes.noShrink}>
        {t("upload.server.processing")}
      </Badge>
    );
  }
  if (state.kind === "ready") {
    return (
      <Badge color="green" variant="light" leftSection={<IconCheck size={12} />} className={classes.noShrink}>
        {t("upload.server.ready")}
      </Badge>
    );
  }
  return (
    <Badge color="red" variant="light" leftSection={<IconAlertCircle size={12} />} className={classes.noShrink}>
      {t("upload.server.not_imported")}
    </Badge>
  );
}

// The steps of an upload's import (api/jobs/upload_import.py UPLOAD_STEPS), by name.
const STAGE_KEYS: Partial<Record<string, ParseKeys>> = {
  media: "upload.server.stage.media",
  album: "upload.server.stage.album",
  date: "upload.server.stage.date",
  tags: "upload.server.stage.tags",
  places: "upload.server.stage.places",
  faces: "upload.server.stage.faces",
};

const stageLabel = (stage: string | null, t: TFunction): string => {
  const key = stage ? STAGE_KEYS[stage] : undefined;
  return key ? t(key) : (stage ?? "");
};

/** Why the server did not import the file, or which later step failed for a ready one. */
function ServerNote({ state }: { state: RowServerState }) {
  const { t } = useTranslation();
  if (state.kind === "ready" && state.problem) {
    return (
      <Text size="xs" c="orange" mt={4} lh={1.3}>
        {t("upload.server.step_failed", { step: stageLabel(state.problem.stage, t), error: state.problem.error ?? "" })}
      </Text>
    );
  }
  if (state.kind !== "failed") return null;
  return (
    <Stack gap={2} mt={6} align="flex-start">
      <Text size="xs" c="red" lh={1.3}>
        {failureText(state.failure, t)}
      </Text>
      <Anchor size="xs" renderRoot={props => <Link to="/jobs" {...props} />}>
        {t("upload.server.view_jobs")}
      </Anchor>
    </Stack>
  );
}

const failureText = (failure: UploadFailedFile | undefined, t: TFunction): string =>
  failure ? t("upload.server.not_read", { error: failure.error ?? "" }) : t("upload.server.lost");

/** The row's icon: the server's thumbnail once the photo is ready, otherwise the file type. */
function RowIcon({ item, ready }: { item: UploadItem; ready: boolean }) {
  const isVideo = item.file.type.startsWith("video/");
  if (ready && item.photoId) return <MediaThumbnail imageHash={item.photoId} size={16} video={isVideo} radius={2} />;
  const FileIcon = isVideo ? IconVideo : IconPhoto;
  return <FileIcon size={16} className={classes.fileIcon} />;
}

type Props = { item: UploadItem; server: RowServerState; onRetry: (item: UploadItem) => void };

/** One file of the upload card: its name, where it stands, and why it failed. */
export function UploadRow({ item, server, onRetry }: Props) {
  const { t } = useTranslation();
  return (
    <Paper withBorder radius="sm" px="sm" py={6} data-testid="upload-row">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="xs" wrap="nowrap" miw="0">
          <RowIcon item={item} ready={server.kind === "ready"} />
          <Text size="sm" truncate title={item.file.name}>
            {item.file.name}
          </Text>
        </Group>
        {server.kind === "untracked" ? <StatusBadge status={item.status} /> : <ServerBadge state={server} />}
      </Group>
      <AlbumOutcomeNote item={item} />
      <ServerNote state={server} />
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
