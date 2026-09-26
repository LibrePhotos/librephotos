import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { DateAlbumQueryKeys } from "../../albums/hooks/useFetchDateAlbumQuery";
import { DateAlbumsQueryKeys } from "../../albums/hooks/useFetchDateAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { PhotoMonthCountQueryKeys } from "../../stats/hooks/useFetchPhotoMonthCountQuery";
import { BulkPhotoQuery } from "../types";
import { RecentlyAddedPhotosQueryKeys } from "./useFetchRecentlyAddedPhotosQuery";

const DeletePhotosResponse = z.object({
  status: z.boolean(),
  // Hashes, not serialized photos: the backend no longer builds a payload per photo.
  updated_hashes: z.string().array().optional(),
  not_updated_hashes: z.string().array().optional(),
  count: z.number().optional(),
});
type DeletePhotosResponse = z.infer<typeof DeletePhotosResponse>;

// Request type for individual photo hashes
type IndividualRequest = {
  select_all?: false;
  image_hashes: string[];
  deleted: boolean;
};

// Request type for select_all mode
type SelectAllRequest = {
  select_all: true;
  query: BulkPhotoQuery;
  excluded_hashes?: string[];
  deleted: boolean;
};

type DeletePhotosRequest = IndividualRequest | SelectAllRequest;

export const useMarkPhotosDeletedMutation = () =>
  useMutation({
    mutationFn: async (request: DeletePhotosRequest) => {
      const response = await fetchClient.post("/photosedit/setdeleted/", request);
      const data = parseWithNotification(
        DeletePhotosResponse,
        response,
        "Failed to parse mark photos deleted response"
      );

      // Show notification based on mode
      if (request.select_all) {
        notification.togglePhotoDelete(request.deleted, data.count ?? 0);
      } else {
        notification.togglePhotoDelete(request.deleted, data.count ?? request.image_hashes.length);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...DateAlbumQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...RecentlyAddedPhotosQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...PhotoMonthCountQueryKeys] });
    },
  });
