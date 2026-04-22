import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { fetchClient, queryClient } from "../../api";
import { FacesQueryKeys } from "../../faces/hooks/useFetchFacesQuery";
import { IncompleteFacesQueryKeys } from "../../faces/hooks/useFetchIncompleteFacesQuery";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { PeopleAlbumsQueryKeys } from "./useFetchPeopleAlbumsQuery";

export const useDeletePersonAlbumMutation = () =>
  useMutation({
    mutationFn: async (id: string) => {
      await fetchClient.delete(`/persons/${id}/`);
      notification.deletePerson();
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [...PeopleAlbumsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...FacesQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...IncompleteFacesQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...CountStatsQueryKeys] });
    },
  });
