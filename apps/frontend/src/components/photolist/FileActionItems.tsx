import type { PigPhoto } from "@librephotos/api-client";
import { Menu, Text } from "@mantine/core";
import { IconFaceId as FaceId, IconRefresh as Refresh } from "@tabler/icons-react";
import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { useDetectFacesAgainMutation } from "../../api_client/faces/hooks/useDetectFacesAgainMutation";
import { useRescanSelectedPhotosMutation } from "../../api_client/jobs/hooks/useRescanSelectedPhotosMutation";
import { useJobQueue } from "../../hooks/useJobQueue";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";

/** The most photos one rescan takes; more is a library scan (the server's cap too). */
export const MAX_FILE_ACTION_PHOTOS = 1000;

type Props = Readonly<{
  /** The user's own photos the items act on (`Photo.id`). */
  photoIds: readonly string[];
  /** Why the items are off (nothing selected, Select all), or false while they work. */
  disabledReason?: string | false;
  /** One photo: "Rescan file". */
  single?: boolean;
  /** Called once a request was sent, to end a selection. */
  onDone?: () => void;
  /** The icons' size, the other items' of the menu (the lightbox's are bigger). */
  iconSize?: number;
}>;

/**
 * Rescan files (#2214) and Detect faces again (#524) for some of the owner's photos: in the
 * selection's Photo Actions, the lightbox's ⋮ and the photo page's More. Both start a job at once;
 * while the queue is busy they say so instead (#2237).
 */
export function FileActionItems({
  photoIds,
  disabledReason = false,
  single = false,
  onDone,
  iconSize = ICON_SIZE.menu,
}: Props) {
  const { t } = useTranslation();
  const noteId = useId();
  const queue = useJobQueue();
  const rescan = useRescanSelectedPhotosMutation();
  const detectFaces = useDetectFacesAgainMutation();
  const tooMany = photoIds.length > MAX_FILE_ACTION_PHOTOS && t("fileactions.toomany");
  const reason = disabledReason || tooMany || (queue.busy && t("jobs.queuebusy.reason"));
  const rescanLabel = single ? t("fileactions.rescanfile") : t("fileactions.rescanfiles");

  return (
    <>
      <DisabledReason reason={reason} position="left">
        <Menu.Item
          leftSection={<Refresh size={iconSize} />}
          aria-label={rescanLabel}
          aria-describedby={noteId}
          onClick={() => {
            rescan.mutate(photoIds);
            onDone?.();
          }}
        >
          {rescanLabel}
          <Text id={noteId} size="xs" c="dimmed" aria-hidden>
            {t("fileactions.rescannote")}
          </Text>
        </Menu.Item>
      </DisabledReason>
      <DisabledReason reason={reason} position="left">
        <Menu.Item
          leftSection={<FaceId size={iconSize} />}
          onClick={() => {
            detectFaces.mutate({ photo_ids: photoIds });
            onDone?.();
          }}
        >
          {t("fileactions.detectfaces")}
        </Menu.Item>
      </DisabledReason>
    </>
  );
}

type SelectionProps = Readonly<{
  selectedItems: readonly PigPhoto[];
  selectAllMode: boolean;
  /** The signed-in user, whose photos the items act on. */
  userId: number | null;
  /** Why the selection's actions are off (nothing selected), or false. */
  disabledReason: string | false;
  onDone: () => void;
}>;

/**
 * The selection menu's Files group. Rescan and face detection act on the user's own files only:
 * someone else's photo is left out, and with nothing of theirs selected the group is not shown.
 * Select all has no photo ids to send, so there the items say to pick the photos one by one.
 */
export function SelectionFileItems({ selectedItems, selectAllMode, userId, disabledReason, onDone }: SelectionProps) {
  const { t } = useTranslation();
  const ownPhotoIds = selectedItems
    .filter(item => !item.isTemp && (item.owner === undefined || item.owner.id === userId))
    .map(item => item.id);
  if (!selectAllMode && selectedItems.length > 0 && ownPhotoIds.length === 0) return null;
  return (
    <>
      <Menu.Label>{t("fileactions.files")}</Menu.Label>
      <FileActionItems
        photoIds={ownPhotoIds}
        disabledReason={disabledReason || (selectAllMode && t("fileactions.selectall"))}
        onDone={onDone}
      />
      <Menu.Divider />
    </>
  );
}
