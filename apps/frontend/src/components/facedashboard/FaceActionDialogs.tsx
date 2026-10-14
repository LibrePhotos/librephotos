import React from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal } from "../modals/ConfirmModal";
import { ModalPersonEdit } from "../modals/ModalPersonEdit";
import type { FaceActionsState } from "./hooks/useFaceActions";
import { selectionOf } from "./hooks/useVirtualizedGrid";

type Props = Readonly<{ state: FaceActionsState }>;

/**
 * The dialogs of one face's ⋮ menu. They live on the dashboard, not in the face: the grid unmounts
 * a face that scrolls out of view, and a Menu.Dropdown unmounts when the menu closes.
 */
export function FaceActionDialogs({ state }: Props) {
  const { t } = useTranslation();
  const face = state.targetFace;
  // A labelled face names its person, as the lightbox's delete does; an inferred one has none yet
  const deleteMessage =
    face?.person && face.person_name
      ? t("confirmdialog.deleteface.message", { name: face.person_name })
      : t("confirmdialog.deleteface.messageunnamed");

  return (
    <>
      <ModalPersonEdit
        isOpen={state.labelDialogOpened}
        onRequestClose={state.closeLabelDialog}
        selectedFaces={face ? [selectionOf(face)] : []}
        onPersonChosen={state.labelTargetAs}
      />
      <ConfirmModal
        opened={state.deleteDialogOpened}
        onClose={state.closeDeleteDialog}
        onConfirm={state.deleteTarget}
        irreversible
        title={t("confirmdialog.deleteface.title")}
        message={deleteMessage}
        confirmLabel={t("confirmdialog.deleteface.confirm")}
      />
    </>
  );
}
