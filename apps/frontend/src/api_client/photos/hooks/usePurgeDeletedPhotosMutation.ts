import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient, queryClient } from "../../api";
import { duplicateKeys } from "../../duplicates/keys";
import { serverKeys } from "../../server/keys";
import { statsKeys } from "../../stats/keys";
import { photoGridKeys } from "../keys";
import type { BulkPhotoQuery } from "../types";

// Request type for individual photo hashes
type IndividualRequest = {
  select_all?: false;
  image_hashes: string[];
};

// Request type for select_all mode
type SelectAllRequest = {
  select_all: true;
  query: BulkPhotoQuery;
  excluded_hashes?: string[];
};

type PurgePhotosRequest = IndividualRequest | SelectAllRequest;

const PurgePhotosResponse = z.object({
  status: z.boolean(),
  results: z.string().array().optional(),
  deleted: z.string().array().optional(),
  not_deleted: z.string().array().optional(),
  count: z.number().optional(),
});
type PurgePhotosResponse = z.infer<typeof PurgePhotosResponse>;

export const usePurgeDeletedPhotosMutation = () =>
  useMutation({
    mutationFn: async (request: PurgePhotosRequest) => {
      const response = await apiClient.delete("/photosedit/delete/", request);
      const data = parseWithNotification(PurgePhotosResponse, response, "Failed to parse purge photos response");

      // Show notification based on mode
      if (request.select_all) {
        notification.removePhotos(data.count ?? 0);
      } else {
        notification.removePhotos(data.deleted?.length ?? request.image_hashes.length);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbums") });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbum") });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.recentlyAdded() });
      queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
      queryClient.invalidateQueries({ queryKey: statsKeys.photoMonthCounts() });
      queryClient.invalidateQueries({ queryKey: serverKeys.storageStats() });
      queryClient.invalidateQueries({ queryKey: duplicateKeys.all });
    },
  });
