import { endpoints, photoGridKeys, photoKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";

type RotatePhotosRequest = {
  image_hash: string;
  angle: number;
};

// Rotate photos non-destructively
export const useRotatePhotosMutation = () =>
  useMutation({
    mutationFn: async (request: RotatePhotosRequest) => {
      const data = await endpoints.rotatePhoto(apiClient, request.image_hash, request.angle);
      notification.rotatePhotos(1, request.angle);
      return data;
    },
    onSuccess: (_data, request) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbums") });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("dateAlbum") });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.recentlyAdded() });

      queryClient.invalidateQueries({ queryKey: photoKeys.detail(request.image_hash) });
    },
  });
