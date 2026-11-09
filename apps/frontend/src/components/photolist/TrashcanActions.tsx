import { ActionIcon, Group } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconArrowBackUp as ArrowBackUp, IconTrash as Trash } from "@tabler/icons-react";
import { useLocation } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useMarkPhotosDeletedMutation, usePurgeDeletedPhotosMutation } from "../../api_client/photos/hooks";
import { DisabledReason } from "../common/DisabledReason";
import { ConfirmModal } from "../modals/ConfirmModal";
import { hasSelection, selectedCount, toPhotoSelection } from "./photoListSelection";
import type { Selected } from "./photoListSelection";

type Props = {
  selected: Selected;
  /** The action is done: select mode ends. */
  onDone: () => void;
};

export function TrashcanActions({ selected, onDone }: Readonly<Props>) {
  const [deleteDialogOpen, { open: openDeleteDialog, close: closeDeleteDialog }] = useDisclosure(false);
  const { t } = useTranslation();
  const location = useLocation();
  const markPhotosDeleted = useMarkPhotosDeletedMutation();
  const purgeDeletedPhotos = usePurgeDeletedPhotosMutation();

  const handlePermanentDelete = () => {
    purgeDeletedPhotos.mutate(toPhotoSelection(selected), {
      onSuccess: () => {
        onDone();
        closeDeleteDialog();
      },
    });
  };

  const restore = () => {
    markPhotosDeleted.mutate({ ...toPhotoSelection(selected), deleted: false }, { onSuccess: onDone });
  };

  const count = selectedCount(selected);
  // Shared by each Tooltip and the aria-label of its icon-only button.
  const restoreLabel = count === 1 ? t("trash.restorePhoto") : t("trash.restorePhotos", { count });
  const noSelection = !hasSelection(selected) && t("selectionactions.selectphotosfirst");
  const deleteLabel = count === 1 ? t("trash.deletePermanently") : t("trash.deletePhotosPermanently", { count });

  return (
    <Group>
      {location.pathname.startsWith("/deleted") && (
        <>
          <DisabledReason label={restoreLabel} reason={noSelection} position="bottom">
            <ActionIcon variant="light" color="blue" aria-label={restoreLabel} onClick={restore}>
              <ArrowBackUp />
            </ActionIcon>
          </DisabledReason>

          <DisabledReason label={deleteLabel} reason={noSelection} position="bottom">
            <ActionIcon
              variant="light"
              color="red"
              aria-label={deleteLabel}
              onClick={() => {
                openDeleteDialog();
              }}
            >
              <Trash />
            </ActionIcon>
          </DisabledReason>
        </>
      )}

      <ConfirmModal
        opened={deleteDialogOpen}
        onClose={closeDeleteDialog}
        onConfirm={handlePermanentDelete}
        loading={purgeDeletedPhotos.isPending}
        title={t("trash.deleteConfirmTitle", { count })}
        message={t("trash.permanentDeleteWarning")}
        confirmLabel={deleteLabel}
        irreversible
      />
    </Group>
  );
}
