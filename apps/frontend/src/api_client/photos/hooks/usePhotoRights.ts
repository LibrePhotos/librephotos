import { endpoints, photoKeys, type PhotoRightsUpdate, type RightsKeep } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { selectionArgs, type PhotoSelection } from "../photoSelection";

/** A selection's rights before "Set rights…" changes them (#425): common values, mixed ones, from files. */
export const useRightsSummaryQuery = (selection: PhotoSelection | null) =>
  useQuery({
    queryKey: photoKeys.rightsSummary(selection ?? {}),
    queryFn: () => {
      const [imageHashes, selectAll] = selectionArgs(selection ?? { image_hashes: [] });
      return endpoints.fetchRightsSummary(apiClient, imageHashes, selectAll);
    },
    enabled: selection !== null,
    // Read when the dialog opens; rights saved meanwhile are the dialog's own.
    staleTime: 0,
  });

export type SetPhotosRightsRequest = Readonly<{
  selection: PhotoSelection;
  rights: PhotoRightsUpdate;
  keep: RightsKeep;
}>;

/**
 * Give the selected photos a copyright notice, a creator and a license (#425). Every photo query is
 * refreshed: the info panel of a changed photo shows its rights, and the summary of a dialog opened
 * next reads them again.
 */
export const useSetPhotosRightsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ selection, rights, keep }: SetPhotosRightsRequest) => {
      const [imageHashes, selectAll] = selectionArgs(selection);
      return endpoints.setPhotosRights(apiClient, imageHashes, rights, keep, selectAll);
    },
    onSuccess: result => {
      notification.photosRightsSet(result);
      return queryClient.invalidateQueries({ queryKey: photoKeys.all });
    },
  });
};

/** How many of my photos "Apply" of my default rights would reach (#425). */
export const useRightsDefaultCountsQuery = (enabled: boolean) =>
  useQuery({
    queryKey: photoKeys.rightsDefaultCounts(),
    queryFn: () => endpoints.fetchRightsDefaultCounts(apiClient),
    enabled,
    staleTime: 0,
  });

/** Give my photos my default rights, keeping what `keep` says (#425). */
export const useApplyRightsDefaultMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keep: RightsKeep) => endpoints.applyRightsDefault(apiClient, keep),
    onSuccess: result => {
      notification.photosRightsSet(result);
      return queryClient.invalidateQueries({ queryKey: photoKeys.all });
    },
  });
};
