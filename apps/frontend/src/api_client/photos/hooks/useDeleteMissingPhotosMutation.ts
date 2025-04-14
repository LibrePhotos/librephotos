import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { fetchClient, queryClient } from "../../api";
import { AutoAlbumsQueryKeys } from '../../albums/hooks/useFetchAutoAlbumsQuery';

const DeleteMissingPhotosResponse = z.object({
  status: z.boolean(),
  job_id: z.string().optional(),
});
type DeleteMissingPhotosResponse = z.infer<typeof DeleteMissingPhotosResponse>;

export const useDeleteMissingPhotosMutation = () => useMutation({
  mutationFn: async () => {
    const response = await fetchClient.post('deletemissingphotos', {});
    return DeleteMissingPhotosResponse.parse(response);
  },
  onSuccess: (data) => {
    queryClient.invalidateQueries({ queryKey: [...AutoAlbumsQueryKeys] });
  },
}); 