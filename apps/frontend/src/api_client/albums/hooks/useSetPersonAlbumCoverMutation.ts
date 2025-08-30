import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { PeopleAlbumsQueryKeys } from './useFetchPeopleAlbumsQuery';

type SetPersonAlbumCoverParams = {
  id: string;
  cover_photo: string;
};

export const useSetPersonAlbumCoverMutation = () => useMutation({
  mutationFn: async ({ id, cover_photo }: SetPersonAlbumCoverParams) => {
    await fetchClient.patch(`/persons/${id}/`, { cover_photo });
    notification.setCoverPhoto();
  },
  onSuccess: () => {
    // Person album covers affect the people albums listing
    queryClient.invalidateQueries({ queryKey: [...PeopleAlbumsQueryKeys] });
  },
}); 