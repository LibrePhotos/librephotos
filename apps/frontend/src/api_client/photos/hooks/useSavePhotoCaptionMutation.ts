import { useMutation } from '@tanstack/react-query';
import { z } from "zod";

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";

import { PhotoDetailsQueryKeys } from './useFetchPhotoDetailsQuery';
import { SearchPhotosQueryKeys } from '../../search/hooks/useSearchPhotosQuery';

const StatusResponse = z.object({
  status: z.boolean(),
});
type StatusResponse = z.infer<typeof StatusResponse>;

export const useSavePhotoCaptionMutation = () => useMutation({
  mutationFn: async ({ id, caption }: { id: string; caption: string }) => {
    const response = await fetchClient.post(`/photosedit/savecaption/`, { image_hash: id, caption });
    StatusResponse.parse(response);
    notification.savePhotoCaptions();
  },
  onSuccess: (_, { id }) => {
    queryClient.invalidateQueries({ queryKey: [...PhotoDetailsQueryKeys, id] });
    queryClient.invalidateQueries({ queryKey: [...SearchPhotosQueryKeys] });
  },
}); 