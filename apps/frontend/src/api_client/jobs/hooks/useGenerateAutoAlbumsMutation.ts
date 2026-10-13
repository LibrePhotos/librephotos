import { albumKeys, endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { startJob } from "../startJob";

export const useGenerateAutoAlbumsMutation = () =>
  useMutation({
    mutationFn: async () => {
      const start = await startJob(() => endpoints.generateEventAlbums(apiClient));
      if (!start.alreadyRunning) {
        notification.generateEventAlbums();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: albumKeys.autoAlbums() });
    },
  });
