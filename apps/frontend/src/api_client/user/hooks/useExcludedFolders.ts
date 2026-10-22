import { endpoints, jobKeys, photoGridKeys, statsKeys, userKeys } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { startJob } from "../../jobs/startJob";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

/** The folders inside `path`, a folder of the signed-in user's library (#791). */
export const useLibrarySubfoldersQuery = (path: string, enabled: boolean) =>
  useQuery({
    queryKey: userKeys.librarySubfolders(path),
    queryFn: () => endpoints.fetchLibrarySubfolders(apiClient, path),
    enabled,
  });

/** Leave folders out of the signed-in user's library (#791); the answer says how many photos are outside. */
export const useSetExcludedFoldersMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: (excludedFolders: string[]) => endpoints.setExcludedFolders(apiClient, excludedFolders),
    onSuccess: saved => {
      queryClient.setQueryData(userKeys.libraryFolders("self"), {
        folders: saved.folders,
        excluded_folders: saved.excluded_folders,
      });
      return queryClient.invalidateQueries({ queryKey: userKeys.librarySubfoldersAll() });
    },
  });
};

type Owner = Readonly<{ username: string; count: number }>;

/** Move the signed-in user's photos outside their library to their trash, as a job (#791). */
export const useTrashOwnPhotosOutsideLibraryMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ username, count }: Owner) => {
      const start = await startJob(() => endpoints.trashOwnPhotosOutsideLibrary(apiClient));
      if (!start.alreadyRunning) {
        notification.startTrashPhotosOutsideLibrary(username, count);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
      void queryClient.invalidateQueries({ queryKey: photoGridKeys.all });
      void queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
    },
  });
};
