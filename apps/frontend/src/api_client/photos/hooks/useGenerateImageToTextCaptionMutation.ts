import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { fetchClient, queryClient, QueryKeys } from "../../api";

const StatusResponse = z.object({
  status: z.boolean(),
});
type StatusResponse = z.infer<typeof StatusResponse>;

export const useGenerateImageToTextCaptionMutation = () => useMutation({
  mutationFn: async ({ id }: { id: string }) => {
    const response = await fetchClient.post(`/photosedit/generateim2txt/`, { image_hash: id });
    StatusResponse.parse(response);
  },
  onSuccess: (_, { id }) => {
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbum, id] });
  },
}); 