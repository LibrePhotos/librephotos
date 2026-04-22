import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { AutoAlbumsQueryKeys } from "../../albums/hooks/useFetchAutoAlbumsQuery";
import { DateAlbumQueryKeys } from "../../albums/hooks/useFetchDateAlbumQuery";
import { DateAlbumsQueryKeys } from "../../albums/hooks/useFetchDateAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { PhotoMonthCountQueryKeys } from "../../stats/hooks/useFetchPhotoMonthCountQuery";
import { RecentlyAddedPhotosQueryKeys } from "./useFetchRecentlyAddedPhotosQuery";

const DeleteMissingPhotosResponse = z.object({
  status: z.boolean(),
  job_id: z.string().optional(),
});
type DeleteMissingPhotosResponse = z.infer<typeof DeleteMissingPhotosResponse>;

export const useDeleteMissingPhotosMutation = () =>
  useMutation({
    mutationFn: async () => {
      const response = await fetchClient.post("/deletemissingphotos", {});
      return parseWithNotification(
        DeleteMissingPhotosResponse,
        response,
        "Failed to parse delete missing photos response"
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...AutoAlbumsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...DateAlbumsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...DateAlbumQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...RecentlyAddedPhotosQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...PhotoMonthCountQueryKeys] });
    },
  });
