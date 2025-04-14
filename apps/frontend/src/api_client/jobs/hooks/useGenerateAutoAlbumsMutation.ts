import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";

export const useGenerateAutoAlbumsMutation = () => useMutation({
  mutationFn: async () => {
    await fetchClient.post('/autoalbumgen/', {});
    notification.generateEventAlbums();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
  },
}); 