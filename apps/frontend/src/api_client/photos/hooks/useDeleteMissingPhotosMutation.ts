import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { albumKeys } from "../../albums/keys";
import { fetchClient, queryClient } from "../../api";
import { startJob } from "../../jobs/startJob";
import { statsKeys } from "../../stats/keys";
import { photoGridKeys } from "../keys";

const DeleteMissingPhotosResponse = z.object({
  status: z.boolean(),
  job_id: z.string().optional(),
});
export const useDeleteMissingPhotosMutation = () =>
  useMutation({
    mutationFn: async () => {
      const start = await startJob(() => fetchClient.post("/deletemissingphotos", {}));
      if (!start.alreadyRunning) {
        parseWithNotification(
          DeleteMissingPhotosResponse,
          start.data,
          "Failed to parse delete missing photos response"
        );
      }
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
