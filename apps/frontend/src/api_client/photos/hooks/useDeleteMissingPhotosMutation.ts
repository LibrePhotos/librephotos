import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { albumKeys } from "../../albums/keys";
import { apiClient, queryClient } from "../../api";
import { startJob } from "../../jobs/startJob";
import { statsKeys } from "../../stats/keys";
import { photoGridKeys } from "../keys";

export const useDeleteMissingPhotosMutation = () =>
  useMutation({
    mutationFn: async () => {
      await startJob(() => endpoints.deleteMissingPhotos(apiClient));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: albumKeys.autoAlbums() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbums") });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbum") });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.recentlyAdded() });
      queryClient.invalidateQueries({ queryKey: statsKeys.counts() });
      queryClient.invalidateQueries({ queryKey: statsKeys.photoMonthCounts() });
    },
  });
