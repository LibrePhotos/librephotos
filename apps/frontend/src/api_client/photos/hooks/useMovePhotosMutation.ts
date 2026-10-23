import type { MoveOnConflict, MovePhotosAnswer, MovePhotosResponse } from "@librephotos/api-client";
import { albumKeys, ApiError, endpoints, folderKeys, jobKeys, photoKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { folderName } from "../../../util/folderPaths";
import { apiClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { selectionArgs, type PhotoSelection } from "../photoSelection";
import { countIn, ownJobResult } from "./ownJobResult";

export type MovePhotosRequest = Readonly<{
  selection: PhotoSelection;
  targetFolder: string;
  /** Sort by date (#2774): each photo goes into this folder of its date inside `targetFolder`. */
  folderPattern?: string;
  /** What to do with a taken name; without it a taken name is a 409 `name_conflict` and nothing moves. */
  onConflict?: MoveOnConflict;
}>;

/** What a move did: its counts, read from the request's answer or from its job's result. */
export type MoveCounts = Pick<
  MovePhotosResponse,
  "moved" | "skipped" | "refused" | "failed" | "undated" | "target_folder"
>;

/** The server's answer when a name is taken in the folder and no `onConflict` was sent: the dialog asks. */
export const isNameConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 409 && error.serverCode === "name_conflict";

/** The counts of the "Move Photos" job `jobId` once it has ended. */
async function waitForMoveJob(jobId: string, targetFolder: string): Promise<MoveCounts> {
  const result = await ownJobResult(jobId);
  return {
    target_folder: targetFolder,
    moved: countIn(result, "moved"),
    skipped: countIn(result, "skipped"),
    refused: countIn(result, "refused"),
    failed: countIn(result, "failed"),
    undated: countIn(result, "undated"),
  };
}

async function countsOf(answer: MovePhotosAnswer): Promise<MoveCounts> {
  if (!("job_id" in answer)) return answer;
  notification.movePhotosStarted();
  return waitForMoveJob(answer.job_id, answer.target_folder);
}

/**
 * Move the selected photos, with all their files, to a folder of the library (#352). A large
 * selection moves in a job, which the mutation follows to its end, so the toast and the refresh
 * come when the photos have moved, even after the dialog closed.
 */
export const useMovePhotosMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ selection, targetFolder, folderPattern, onConflict }: MovePhotosRequest) => {
      const [imageHashes, selectAll] = selectionArgs(selection);
      const target = { targetFolder, folderPattern, onConflict };
      const answer = await endpoints.movePhotos(apiClient, imageHashes, target, selectAll);
      return countsOf(answer);
    },
    onSuccess: counts => {
      notification.photosMoved(counts, folderName(counts.target_folder));
      // The folder pages, their photo counts and the photos' file paths changed.
      invalidatePhotoLists(queryClient);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: albumKeys.folders() }),
        queryClient.invalidateQueries({ queryKey: folderKeys.all }),
        queryClient.invalidateQueries({ queryKey: photoKeys.details() }),
        queryClient.invalidateQueries({ queryKey: jobKeys.all }),
      ]);
    },
    // A taken name is the dialog's to ask about; anything else is a failed move.
    onError: error => {
      if (isNameConflict(error)) return;
      notification.photosMoveFailed(error instanceof ApiError ? error.serverMessage : null);
    },
  });
};
