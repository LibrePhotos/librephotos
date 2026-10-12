import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { AutoAlbumsQueryKeys } from "../../albums/hooks/useFetchAutoAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { startJob } from "../startJob";

export const useGenerateAutoAlbumsMutation = () =>
  useMutation({
    mutationFn: async () => {
      const start = await startJob(() => fetchClient.post("/autoalbumgen/", {}));
      if (!start.alreadyRunning) {
        notification.generateEventAlbums();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...AutoAlbumsQueryKeys] });
    },
  });
