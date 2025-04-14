import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient } from "../../api";

type SetPersonAlbumCoverParams = {
  id: string;
  cover_photo: string;
};

export const useSetPersonAlbumCoverMutation = () => useMutation({
  mutationFn: async ({ id, cover_photo }: SetPersonAlbumCoverParams) => {
    await fetchClient.patch(`/persons/${id}/`, { cover_photo });
    notification.setCoverPhoto();
  },
}); 