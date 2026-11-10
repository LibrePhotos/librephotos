import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { useCallback, useMemo } from "react";
import {
  useDeleteFacesMutation,
  useRestoreFacesMutation,
  useSetFacesPersonLabelMutation,
} from "../../../api_client/faces";
import type { FaceActionsState } from "./useFaceActions";
import type { FaceSelection } from "./useVirtualizedGrid";

/** What `track` hands back: the request's callbacks, which only end the faces' pending state. */
type Callbacks = ReturnType<FaceActionsState["track"]>;

/**
 * Delete, Restore, Not this person and Label faces on the selected faces: the faces are pending
 * while the request runs and leave the selection once the server took it. A failed request keeps
 * them selected, so the action can be tried again.
 */
export function useSelectedFaceActions(
  selectedFaces: readonly FaceSelection[],
  dropFaces: (faceIds: readonly number[]) => void,
  track: FaceActionsState["track"]
) {
  const { mutate: deleteFaces } = useDeleteFacesMutation();
  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();
  const { mutate: restoreFaces } = useRestoreFacesMutation();

  const send = useCallback(
    (faces: readonly FaceSelection[], request: (faceIds: number[], callbacks: Callbacks) => void) => {
      if (faces.length === 0) return;
      const faceIds = faces.map(face => face.face_id);
      request(
        faceIds,
        track(faceIds, () => dropFaces(faceIds))
      );
    },
    [track, dropFaces]
  );

  return useMemo(
    () => ({
      deleteSelected: () => send(selectedFaces, (faceIds, callbacks) => deleteFaces({ faceIds }, callbacks)),
      // The Deleted tab's Restore (#127)
      restoreSelected: () => send(selectedFaces, (faceIds, callbacks) => restoreFaces({ faceIds }, callbacks)),
      rejectSelected: () =>
        send(selectedFaces, (faceIds, callbacks) =>
          setFacesPersonLabel({ faceIds, personName: UNKNOWN_PERSON_NAME }, callbacks)
        ),
      /** The Label faces dialog: the selection, or a cluster's faces ("Add a name"). */
      label: (faces: readonly FaceSelection[], personName: string) =>
        send(faces, (faceIds, callbacks) => setFacesPersonLabel({ faceIds, personName }, callbacks)),
    }),
    [send, selectedFaces, deleteFaces, restoreFaces, setFacesPersonLabel]
  );
}
