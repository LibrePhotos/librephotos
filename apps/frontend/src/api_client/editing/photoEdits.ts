/**
 * A photo's edit (non-destructive photo editing): its recipe and history, saved and deleted by the
 * photo's id, and the reduced source the editor's preview works on.
 */
import { endpoints, photoGridKeys, photoKeys, type PhotoEdit, type PhotoEditUpdate } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiClient } from "../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../mutationErrors";

/** A photo's edit; `photoId` undefined waits. A photo never edited answers the default recipe at version 0. */
export const usePhotoEditQuery = (photoId: string | undefined) =>
  useQuery({
    queryKey: photoKeys.edit(photoId ?? ""),
    queryFn: () => endpoints.fetchPhotoEdit(apiClient, photoId ?? ""),
    enabled: photoId !== undefined,
    // The editor opens on the saved state; an edit saved meanwhile in another tab is read again.
    staleTime: 0,
  });

/** What a save sends: the photo and its recipe, history and cursor. */
export type SavePhotoEditRequest = Readonly<{ photoId: string; edit: PhotoEditUpdate }>;

/**
 * What a saved or removed edit changes besides the edit itself: the photo's details (its `edit`
 * field and size) and every grid, whose thumbnails the server rendered again.
 */
function refreshEditedPhoto(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: photoKeys.details() }),
    queryClient.invalidateQueries({ queryKey: photoGridKeys.all }),
  ]);
}

/**
 * Save a photo's edit; the answer (the new version and rendition state) replaces the cached edit.
 * The mutation settles when the server has answered: the editor closes then, and the details and
 * grids it refreshes come in behind it.
 */
export const useSavePhotoEditMutation = (options?: MutationErrorOptions) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ photoId, edit }: SavePhotoEditRequest) => endpoints.savePhotoEdit(apiClient, photoId, edit),
    meta: mutationErrorMeta(options),
    onSuccess: (saved: PhotoEdit, { photoId }) => {
      queryClient.setQueryData(photoKeys.edit(photoId), saved);
      void refreshEditedPhoto(queryClient);
    },
  });
};

/**
 * Remove a photo's edit, history and rendition: the photo shows its original again. Like a save, it
 * settles when the server has answered, not after the refreshes.
 */
export const useDeletePhotoEditMutation = (options?: MutationErrorOptions) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => endpoints.deletePhotoEdit(apiClient, photoId),
    meta: mutationErrorMeta(options),
    onSuccess: (_result, photoId) => {
      void queryClient.invalidateQueries({ queryKey: photoKeys.edit(photoId) });
      void refreshEditedPhoto(queryClient);
    },
  });
};

/**
 * The reduced source of a photo as an edit source file ("LPES"), for the editor's preview. Not
 * cached by React Query: it is several megabytes, read once when the editor opens.
 */
export function fetchEditSource(photoId: string): Promise<ArrayBuffer> {
  return endpoints.fetchPhotoEditSource(apiClient, photoId);
}
