import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../../api";

export const useDeletePersonAlbumMutation = () => useMutation({
  mutationFn: async (id: string) => {
    await fetchClient.delete(`/persons/${id}/`);
    notification.deletePerson();
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.peopleAlbums] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.faces] });
  },
}); 