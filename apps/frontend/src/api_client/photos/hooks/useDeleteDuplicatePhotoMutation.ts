import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { AutoAlbumsQueryKeys } from "../../albums/hooks/useFetchAutoAlbumsQuery";
import { DateAlbumQueryKeys } from "../../albums/hooks/useFetchDateAlbumQuery";
import { DateAlbumsQueryKeys } from "../../albums/hooks/useFetchDateAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { PhotoMonthCountQueryKeys } from "../../stats/hooks/useFetchPhotoMonthCountQuery";
import { RecentlyAddedPhotosQueryKeys } from "./useFetchRecentlyAddedPhotosQuery";

type DeleteDuplicatePhotoRequest = {
  image_hash: string;
  path: string;
};

export const useDeleteDuplicatePhotoMutation = () =>
  useMutation({
    mutationFn: async ({ image_hash, path }: DeleteDuplicatePhotoRequest) => {
      await fetchClient.delete("/photosedit/duplicate/delete/", { image_hash, path });
      notification.removePhotos(1);
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
