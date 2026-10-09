import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { PhotoMonthCountQueryKeys } from "../../stats/hooks/useFetchPhotoMonthCountQuery";
import { invalidatePhotoLists } from "../invalidatePhotoLists";
import { BulkPhotoQuery } from "../types";
import { PhotoDetailsQueryKeys } from "./useFetchPhotoDetailsQuery";

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

      // Show notification based on mode; a no-op (e.g. already in the trash)
      // gets no "0 photos were moved to trash" toast.
      const count = request.select_all ? (data.count ?? 0) : (data.count ?? request.image_hashes.length);
      if (count > 0) {
        notification.togglePhotoDelete(request.deleted, count);
      }

      return data;
    },
    onSuccess: () => {
      invalidatePhotoLists();
      // Cached details hold in_trashcan, which drives the lightbox's Delete/Restore toggle.
      queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...PhotoMonthCountQueryKeys] });
    },
  });
