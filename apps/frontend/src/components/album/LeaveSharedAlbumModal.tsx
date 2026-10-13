import type { SimpleUser } from "@librephotos/api-client";
import React from "react";
import { useTranslation } from "react-i18next";
import { useLeaveSharedAlbumMutation } from "../../api_client/albums/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";
import { sharerName } from "../sharing/sharerGroups";

/** The album being left: named in the question, its owner in what happens next. */
export type LeavableAlbum = Readonly<{ id: number | string; title: string; owner: SimpleUser }>;

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  album: LeavableAlbum;
  /** After the server took the album off your list: the album page leaves for "Shared with me". */
  onLeft?: () => void;
}>;

/**
 * Asks before leaving an album someone shared with you (#2210), from the album page and from the
 * "Shared with me" grid. Stays open, locked, until the server answered; a failure is toasted.
 */
export function LeaveSharedAlbumModal({ opened, onClose, album, onLeft }: Props) {
  const { t } = useTranslation();
  const leave = useLeaveSharedAlbumMutation();
  return (
    <ConfirmModal
      opened={opened}
      onClose={onClose}
      onConfirm={() =>
        leave.mutate(
          { id: String(album.id), title: album.title },
          {
            onSuccess: () => {
              onClose();
              onLeft?.();
            },
          }
        )
      }
      loading={leave.isPending}
      title={t("useralbum.leavealbumtitle", { title: album.title })}
      message={t("useralbum.leavealbummessage", { owner: sharerName(album.owner, album.owner.username) })}
      confirmLabel={t("useralbum.leavealbum")}
    />
  );
}
