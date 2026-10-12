import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { ApiError, fetchClient, queryClient } from "../../api";
import { SearchPhotosQueryKeys } from "../../search/hooks/useSearchPhotosQuery";
import { PhotoDetailsQueryKeys } from "./useFetchPhotoDetailsQuery";

const StatusResponse = z.object({
  status: z.boolean(),
});

export const useGenerateImageToTextCaptionMutation = () =>
  useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const response = await fetchClient.post(`/photosedit/generateim2txt/`, { image_hash: id });
      parseWithNotification(StatusResponse, response, "Failed to parse generate image to text caption response");
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys, id] });
      queryClient.invalidateQueries({ queryKey: [...SearchPhotosQueryKeys] });
    },
    onError: error => {
      // The model is fetched with the other models; a fresh install can ask
      // for a caption before that ran. The backend starts the download and
      // answers 503 with this code. A 500 already showed its own toast.
      if (error instanceof ApiError && error.serverCode === "model_downloading") {
        notification.captionModelDownloading();
      }
    },
  });
