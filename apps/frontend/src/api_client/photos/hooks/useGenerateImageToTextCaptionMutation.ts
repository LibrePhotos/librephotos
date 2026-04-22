import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { SearchPhotosQueryKeys } from "../../search/hooks/useSearchPhotosQuery";
import { PhotoDetailsQueryKeys } from "./useFetchPhotoDetailsQuery";

const StatusResponse = z.object({
  status: z.boolean(),
});
type StatusResponse = z.infer<typeof StatusResponse>;

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
  });
