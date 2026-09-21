import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { SearchPhotosQueryKeys } from "../../search/hooks/useSearchPhotosQuery";
import { PhotoDetailsQueryKeys } from "./useFetchPhotoDetailsQuery";

const StatusResponse = z.object({
  status: z.boolean(),
  reason: z.string().optional(),
  message: z.string().optional(),
});
type StatusResponse = z.infer<typeof StatusResponse>;

export const useGenerateImageToTextCaptionMutation = () =>
  useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const response = await fetchClient.post(`/photosedit/generateim2txt/`, { image_hash: id });
      const parsed = parseWithNotification(
        StatusResponse,
        response,
        "Failed to parse generate image to text caption response"
      );
      // The model is fetched with the other models; a fresh install can ask
      // for a caption before that ran. The backend starts the download and
      // answers with a reason instead of a caption.
      if (parsed && !parsed.status && parsed.reason === "model_downloading") {
        notification.captionModelDownloading();
      }
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys, id] });
      queryClient.invalidateQueries({ queryKey: [...SearchPhotosQueryKeys] });
    },
  });
