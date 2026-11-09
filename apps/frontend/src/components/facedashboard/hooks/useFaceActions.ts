import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { useDisclosure } from "@mantine/hooks";
import { useCallback, useMemo, useState } from "react";
import {
  useDeleteFacesMutation,
  useRestoreFacesMutation,
  useSetFacesPersonLabelMutation,
} from "../../../api_client/faces";
import type { FaceActionHandlers } from "../faceActionRules";
import type { FaceCell } from "./useVirtualizedGrid";

/** Adds or drops face ids from a set without changing the one React holds. */
function toggled(ids: ReadonlySet<number>, faceIds: readonly number[], pending: boolean): ReadonlySet<number> {
  const next = new Set(ids);
  faceIds.forEach(id => (pending ? next.add(id) : next.delete(id)));
  return next;
}

/**
 * The per-face actions of the faces dashboard (#599), Restore on the Deleted tab (#127), and the
 * state of the two dialogs they open: Label faces for one face, and the delete confirmation.
 *
 * A face an action was sent for is "pending": dimmed and without buttons until the server answers,
 * so a quick second click cannot hit it again and the review loop gets instant feedback. On success
 * the edit has already taken the face out of the cached lists; a face that shows up again (moved to
 * another person on the same tab) is not pending there.
 */
export function useFaceActions() {
  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();
  const { mutate: deleteFaces } = useDeleteFacesMutation();
  const { mutate: restoreFaces } = useRestoreFacesMutation();
  const [pendingFaceIds, setPendingFaceIds] = useState<ReadonlySet<number>>(() => new Set());
  // The face a dialog is about stays set while the dialog animates closed
  const [targetFace, setTargetFace] = useState<FaceCell | null>(null);
  const [labelDialogOpened, { open: openLabelDialog, close: closeLabelDialog }] = useDisclosure(false);
  const [deleteDialogOpened, { open: openDeleteDialog, close: closeDeleteDialog }] = useDisclosure(false);

  /**
   * Marks the faces pending and hands back the callbacks of the request sent for them, which end
   * it. The QueryClient's toast reports a failure; this only gives the faces their buttons back.
   */
  const track = useCallback((faceIds: readonly number[], onSuccess?: () => void) => {
    setPendingFaceIds(ids => toggled(ids, faceIds, true));
    const settle = () => setPendingFaceIds(ids => toggled(ids, faceIds, false));
    return {
      onSuccess: () => {
        settle();
        onSuccess?.();
      },
      onError: settle,
    };
  }, []);

  const labelFace = useCallback(
    (face: FaceCell, personName: string) => {
      setFacesPersonLabel({ faceIds: [face.id], personName }, track([face.id]));
    },
    [track, setFacesPersonLabel]
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
      restore: face => restoreFaces({ faceIds: [face.id] }, track([face.id])),
    }),
    [labelFace, track, restoreFaces, openLabelDialog, openDeleteDialog]
  );

  const labelTargetAs = (personName: string) => {
    if (targetFace) labelFace(targetFace, personName);
  };

  const deleteTarget = () => {
    if (targetFace) {
      const faceIds = [targetFace.id];
      deleteFaces({ faceIds }, track(faceIds));
    }
    closeDeleteDialog();
  };

  // The tabs show other lists: a face rejected on Labeled shows up on Unknown, and is not pending there
  const clearPending = useCallback(() => setPendingFaceIds(new Set()), []);

  return {
    actions,
    pendingFaceIds,
    track,
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
