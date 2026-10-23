import { endpoints, libraryShareKeys, photoGridKeys, photoKeys } from "@librephotos/api-client";
import type { LibraryShare, LibraryShareSwitches } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { notification } from "../../service/notifications";
import { apiClient } from "../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../mutationErrors";

/** The libraries I share and the ones shared with me (#2731), every page. */
export const useLibrarySharesQuery = () =>
  useQuery({
    queryKey: libraryShareKeys.list(),
    queryFn: () => endpoints.fetchLibraryShares(apiClient),
  });

/**
 * A share changes what my timeline, my search and every photo's details show: the shares, every
 * grid and the photo details refresh together.
 */
function refreshAfterShareChange(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: libraryShareKeys.all }),
    queryClient.invalidateQueries({ queryKey: photoGridKeys.all }),
    queryClient.invalidateQueries({ queryKey: photoKeys.details() }),
  ]);
}

type CreateParams = { recipientId: number; recipientName: string; switches: Partial<LibraryShareSwitches> };

/** Share my library with a user, read-only. */
export const useCreateLibraryShareMutation = (options?: MutationErrorOptions) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ recipientId, switches }: CreateParams) =>
      endpoints.createLibraryShare(apiClient, recipientId, switches),
    onSuccess: (_, { recipientName }) => {
      notification.libraryShared(recipientName);
      return refreshAfterShareChange(queryClient);
    },
  });
};

type UpdateParams = {
  shareId: number;
  patch: Partial<LibraryShareSwitches & Pick<LibraryShare, "show_in_timeline">>;
};

/** Change one switch of a share: the owner's `share_*`, or the recipient's `show_in_timeline`. */
export const useUpdateLibraryShareMutation = (options?: MutationErrorOptions) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ shareId, patch }: UpdateParams) => endpoints.updateLibraryShare(apiClient, shareId, patch),
    onSuccess: () => refreshAfterShareChange(queryClient),
  });
};

type DeleteParams = { shareId: number; side: "owner" | "recipient"; name: string };

/** The owner stops sharing, or the recipient leaves the library. */
export const useDeleteLibraryShareMutation = (options?: MutationErrorOptions) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ shareId }: DeleteParams) => endpoints.deleteLibraryShare(apiClient, shareId),
    onSuccess: (_, { side, name }) => {
      if (side === "owner") notification.libraryShareStopped(name);
      else notification.libraryLeft(name);
      return refreshAfterShareChange(queryClient);
    },
  });
};
