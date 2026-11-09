import type { UploadFailedFile } from "@librephotos/api-client";
import { Anchor, Button, Loader, Progress, Stack, Text } from "@mantine/core";
import { IconCheck, IconPhoto, IconRotateClockwise, IconVideo } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { ParseKeys, TFunction } from "i18next";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { MediaThumbnail } from "../common/MediaThumbnail";
import { AlbumOutcomeNote } from "./UploadAlbumStrip";
import type { RowServerState } from "./uploadProcessing";
import classes from "./UploadProgressCard.module.css";
import { useFileThumbnail } from "./useFileThumbnail";
import type { UploadItem, UploadStatus } from "./useUploadQueue";

const isBusy = (status: UploadStatus) => status === "hashing" || status === "uploading";

/**
 * Where a file stands, in 12px sentence case under its name ("Waiting", "Uploading 42 %"): dimmed
 * text, only a failure in red, as Google Photos' upload list. No chips.
 */
function StatusLine({ item, server }: { item: UploadItem; server: RowServerState }) {
  const { t } = useTranslation();
  let text: string;
  let failed = false;
  if (server.kind === "processing") text = t("upload.server.processing");
  else if (server.kind === "ready") text = t("upload.server.ready");
  else if (server.kind === "failed") {
    text = t("upload.server.not_imported");
    failed = true;
  } else if (item.status === "uploading") text = t("upload.status.uploading_percent", { percent: item.progress });
  else {
    text = t(`upload.status.${item.status}`);
    failed = item.status === "error";
  }
  return (
    <Text component="span" className={failed ? classes.statusFailed : classes.status}>
      {text}
    </Text>
  );
}

/** The row's right edge: a spinner while busy, a check once it is in, nothing while waiting. */
function RowEnd({ item, server }: { item: UploadItem; server: RowServerState }) {
  if (server.kind === "processing" || (server.kind === "untracked" && isBusy(item.status)))
    return (
      <span className={classes.rowEnd} aria-hidden>
        <Loader size={14} />
      </span>
    );
  if (server.kind === "ready" || (server.kind === "untracked" && item.status === "done"))
    return <IconCheck size={16} className={classes.rowCheck} aria-hidden />;
  return null;
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

/**
 * The row's 32px thumbnail: the server's once the photo is ready, before that the picked file itself
 * (an object URL), otherwise the file type's glyph (a video, a format the browser cannot show).
 */
function RowThumbnail({ item, ready }: { item: UploadItem; ready: boolean }) {
  const local = useFileThumbnail(item.file);
  const [broken, setBroken] = useState(false);
  const isVideo = item.file.type.startsWith("video/");
  if (ready && item.photoId)
    return <MediaThumbnail imageHash={item.photoId} size={32} video={isVideo} radius={6} className={classes.thumb} />;
  if (local && !broken)
    return <img src={local} alt="" className={classes.thumb} decoding="async" onError={() => setBroken(true)} />;
  const FileIcon = isVideo ? IconVideo : IconPhoto;
  return (
    <span className={classes.thumbPlaceholder}>
      <FileIcon size={16} />
    </span>
  );
}

type Props = { item: UploadItem; server: RowServerState; onRetry: (item: UploadItem) => void };

/**
 * One file of the upload card: a flat 44px row of the card's one list (hairlines between rows),
 * its thumbnail, name and where it stands, a 2px progress line along the bottom while it uploads,
 * and why it failed.
 */
export function UploadRow({ item, server, onRetry }: Props) {
  const { t } = useTranslation();
  return (
    <div className={classes.row} data-testid="upload-row">
      <RowThumbnail item={item} ready={server.kind === "ready"} />
      <div className={classes.rowText}>
        <Text className={classes.name} truncate title={item.file.name}>
          {item.file.name}
        </Text>
        <StatusLine item={item} server={server} />
        <AlbumOutcomeNote item={item} />
        <ServerNote state={server} />
        {item.status === "error" && (
          <Text size="xs" c="dimmed" lh={1.3} mt={2}>
            {item.error || t("upload.unknown_error")}
          </Text>
        )}
      </div>
      {item.status === "error" ? (
        <Button
          size="compact-xs"
          variant="subtle"
          className={classes.noShrink}
          leftSection={<IconRotateClockwise size={12} />}
          onClick={() => onRetry(item)}
        >
          {t("upload.retry")}
        </Button>
      ) : (
        <RowEnd item={item} server={server} />
      )}
      {item.status === "uploading" && (
        <Progress value={item.progress} size={2} radius={0} className={classes.rowProgress} aria-hidden />
      )}
    </div>
  );
}
