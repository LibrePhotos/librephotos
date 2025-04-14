import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { AutoAlbumsQueryKeys } from '../../albums/hooks/useFetchAutoAlbumsQuery';

export const useGenerateAutoAlbumsMutation = () => useMutation({
  mutationFn: async () => {
    await fetchClient.post('/autoalbumgen/', {});
    notification.generateEventAlbums();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [...AutoAlbumsQueryKeys] });
  },
}); 