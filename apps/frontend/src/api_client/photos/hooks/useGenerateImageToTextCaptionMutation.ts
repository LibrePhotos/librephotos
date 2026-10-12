import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient, ApiError, queryClient } from "../../api";
import { photoGridKeys, photoKeys } from "../keys";

const StatusResponse = z.object({
  status: z.boolean(),
});

export const useGenerateImageToTextCaptionMutation = () =>
  useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const response = await apiClient.post(`/photosedit/generateim2txt/`, { image_hash: id });
      parseWithNotification(StatusResponse, response, "Failed to parse generate image to text caption response");
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: photoKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.kind("search") });
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
