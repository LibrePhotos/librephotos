import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { PeopleAlbumsQueryKeys } from './useFetchPeopleAlbumsQuery';
import { FacesQueryKeys } from '../../faces/hooks/useFetchFacesQuery';

export const useDeletePersonAlbumMutation = () => useMutation({
  mutationFn: async (id: string) => {
    await fetchClient.delete(`/persons/${id}/`);
    notification.deletePerson();
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [...PeopleAlbumsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...FacesQueryKeys] });
  },
}); 