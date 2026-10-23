import type { RenamePhotosAnswer, RenamePhotosResponse } from "@librephotos/api-client";
import { ApiError, endpoints, folderKeys, jobKeys, photoKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { selectionArgs, type PhotoSelection } from "../photoSelection";
import { countIn, ownJobResult } from "./ownJobResult";

type RenamePhotosRequest = Readonly<{ selection: PhotoSelection; pattern: string }>;

/** What a rename did: its counts, read from the request's answer or from its job's result. */
type RenameCounts = RenamePhotosResponse;

/** The counts of the "Rename Photos" job `jobId` once it has ended. */
async function waitForRenameJob(jobId: string): Promise<RenameCounts> {
  const result = await ownJobResult(jobId);
  return {
    renamed: countIn(result, "renamed"),
    unchanged: countIn(result, "unchanged"),
    undated: countIn(result, "undated"),
    refused: countIn(result, "refused"),
    failed: countIn(result, "failed"),
  };
}

async function countsOf(answer: RenamePhotosAnswer): Promise<RenameCounts> {
  if (!("job_id" in answer)) return answer;
  notification.renamePhotosStarted();
  return waitForRenameJob(answer.job_id);
}

/**
 * Rename the selected photos, with all their files, after their capture date (#2773). A large
 * selection is renamed in a job, which the mutation follows to its end, so the toast and the
 * refresh come when the files have their new names, even after the dialog closed.
 */
export const useRenamePhotosMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ selection, pattern }: RenamePhotosRequest) => {
      const [imageHashes, selectAll] = selectionArgs(selection);
      return countsOf(await endpoints.renamePhotos(apiClient, imageHashes, pattern, selectAll));
    },
    onSuccess: counts => {
      notification.photosRenamed(counts);
      // The photos' file paths and the folder pages' file names changed.
      invalidatePhotoLists(queryClient);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: folderKeys.all }),
        queryClient.invalidateQueries({ queryKey: photoKeys.details() }),
        queryClient.invalidateQueries({ queryKey: jobKeys.all }),
      ]);
    },
    onError: error => {
      notification.photosRenameFailed(error instanceof ApiError ? error.serverMessage : null);
    },
  });
};
