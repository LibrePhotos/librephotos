import { endpoints, statsKeys, userKeys, type LibraryFolders } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

/** Whose library: the signed-in user's own, or (admins) a user's by id. */
export type LibraryOwner = number | "self";

const fetchFolders = (owner: LibraryOwner) =>
  owner === "self" ? endpoints.fetchOwnLibraryFolders(apiClient) : endpoints.fetchLibraryFolders(apiClient, owner);

/** The folders of a library (#123), the scan directory first. */
export const useLibraryFoldersQuery = (owner: LibraryOwner, enabled = true) =>
  useQuery({
    queryKey: userKeys.libraryFolders(owner),
    queryFn: () => fetchFolders(owner),
    enabled,
  });

/** After an add or a remove: the answer is the new list, for that user and for "self" alike. */
function useStoreFolders(userId: number) {
  const queryClient = useQueryClient();
  return (folders: LibraryFolders) => {
    queryClient.setQueryData(userKeys.libraryFolders(userId), folders);
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: userKeys.libraryFolders("self") }),
      queryClient.invalidateQueries({ queryKey: statsKeys.counts() }),
    ]);
  };
}

/** Admin: add a folder to a user's library (#123). A refused folder is a 400 naming `path`. */
export const useAddLibraryFolderMutation = (userId: number, options: MutationErrorOptions = {}) => {
  const storeFolders = useStoreFolders(userId);
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: (path: string) => endpoints.addLibraryFolder(apiClient, userId, path),
    onSuccess: storeFolders,
  });
};

/** Admin: remove a further folder from a user's library (#123); its photos stay. */
export const useRemoveLibraryFolderMutation = (userId: number, options: MutationErrorOptions = {}) => {
  const storeFolders = useStoreFolders(userId);
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: (folderId: number) => endpoints.removeLibraryFolder(apiClient, userId, folderId),
    onSuccess: storeFolders,
  });
};
