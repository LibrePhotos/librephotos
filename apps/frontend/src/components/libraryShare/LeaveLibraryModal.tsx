import type { LibraryShare } from "@librephotos/api-client";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDeleteLibraryShareMutation } from "../../api_client/libraryShares/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";
import { firstName, personName } from "./libraryShareFields";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  share: LibraryShare;
  /** After the server ended the share: the library page leaves for Sharing. */
  onLeft?: () => void;
}>;

/** Leave a library someone shares with me (#2731), as leaving a shared album asks first. */
export function LeaveLibraryModal({ opened, onClose, share, onLeft }: Props) {
  const { t } = useTranslation();
  const leave = useDeleteLibraryShareMutation();
  const name = firstName(share.owner);
  return (
    <ConfirmModal
      opened={opened}
      onClose={onClose}
      onConfirm={() =>
        leave.mutate(
          { shareId: share.id, side: "recipient", name: personName(share.owner) },
          {
            onSuccess: () => {
              onClose();
              onLeft?.();
            },
          }
        )
      }
      loading={leave.isPending}
      title={t("librarySharing.leaveTitle", { name })}
      message={t("librarySharing.leaveMessage", { name })}
      confirmLabel={t("librarySharing.leave")}
    />
  );
}
