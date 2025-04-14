import { useMutation } from '@tanstack/react-query';

import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { PeopleAlbumsQueryKeys } from './useFetchPeopleAlbumsQuery';
import { FacesQueryKeys } from '../../faces/hooks/useFetchFacesQuery';

type RenamePersonAlbumParams = {
  id: string;
  personName: string;
  newPersonName: string;
};

export const useRenamePersonAlbumMutation = () => useMutation({
  mutationFn: async ({ id, personName, newPersonName }: RenamePersonAlbumParams) => {
    await fetchClient.patch(`/persons/${id}/`, { newPersonName });
    notification.renamePerson(personName, newPersonName);
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [...PeopleAlbumsQueryKeys] });
    queryClient.invalidateQueries({ queryKey: [...FacesQueryKeys] });
  },
}); 