import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { useDisclosure } from "@mantine/hooks";
import { useCallback, useMemo, useState } from "react";
import { useDeleteFacesMutation, useSetFacesPersonLabelMutation } from "../../../api_client/faces";
import type { FaceActionHandlers } from "../faceActionRules";
import type { FaceCell } from "./useVirtualizedGrid";

/** Adds or drops face ids from a set without changing the one React holds. */
function toggled(ids: ReadonlySet<number>, faceIds: readonly number[], pending: boolean): ReadonlySet<number> {
  const next = new Set(ids);
  faceIds.forEach(id => (pending ? next.add(id) : next.delete(id)));
  return next;
}

/**
 * The per-face actions of the faces dashboard (#599) and the state of the two dialogs they open:
 * Label faces for one face, and the delete confirmation.
 *
 * A face an action was sent for is "pending": dimmed and without buttons until the refreshed list
 * drops it, so a quick second click cannot hit it again and the review loop gets instant feedback.
 */
export function useFaceActions() {
  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();
  const { mutate: deleteFaces } = useDeleteFacesMutation();
  const [pendingFaceIds, setPendingFaceIds] = useState<ReadonlySet<number>>(() => new Set());
  // The face a dialog is about stays set while the dialog animates closed
  const [targetFace, setTargetFace] = useState<FaceCell | null>(null);
  const [labelDialogOpened, { open: openLabelDialog, close: closeLabelDialog }] = useDisclosure(false);
  const [deleteDialogOpened, { open: openDeleteDialog, close: closeDeleteDialog }] = useDisclosure(false);

  const markPending = useCallback((faceIds: readonly number[], pending: boolean) => {
    setPendingFaceIds(ids => toggled(ids, faceIds, pending));
  }, []);

  const labelFace = useCallback(
    (face: FaceCell, personName: string) => {
      markPending([face.id], true);
      // The QueryClient's toast reports the failure; this only gives the face its buttons back
      setFacesPersonLabel({ faceIds: [face.id], personName }, { onError: () => markPending([face.id], false) });
    },
    [markPending, setFacesPersonLabel]
  );

  const actions = useMemo<FaceActionHandlers>(
    () => ({
      confirm: labelFace,
      rejectMatch: face => labelFace(face, UNKNOWN_PERSON_NAME),
      labelAs: face => {
        setTargetFace(face);
        openLabelDialog();
      },
      remove: face => {
        setTargetFace(face);
        openDeleteDialog();
      },
    }),
    [labelFace, openLabelDialog, openDeleteDialog]
  );

  const labelTargetAs = (personName: string) => {
    if (targetFace) labelFace(targetFace, personName);
  };

  const deleteTarget = () => {
    if (targetFace) {
      const faceIds = [targetFace.id];
      markPending(faceIds, true);
      deleteFaces({ faceIds }, { onError: () => markPending(faceIds, false) });
    }
    closeDeleteDialog();
  };

  // The tabs show other lists: a face rejected on Labeled shows up on Unknown, and is not pending there
  const clearPending = useCallback(() => setPendingFaceIds(new Set()), []);

  return {
    actions,
    pendingFaceIds,
    clearPending,
    targetFace,
    labelDialogOpened,
    closeLabelDialog,
    labelTargetAs,
    deleteDialogOpened,
    closeDeleteDialog,
    deleteTarget,
  };
}

export type FaceActionsState = ReturnType<typeof useFaceActions>;
