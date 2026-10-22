import { albumKeys, endpoints } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";

type SetPersonBirthDateParams = {
  id: string;
  /** For the toast. */
  name: string;
  /** `YYYY-MM-DD`, or null to remove it. */
  birthDate: string | null;
};

/** Set or remove a person's birth date (#2750): the person page shows ages from it. */
export const useSetPersonBirthDateMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, birthDate }: SetPersonBirthDateParams) => endpoints.setPersonBirthDate(apiClient, id, birthDate),
    onSuccess: (_, { name, birthDate }) => {
      notification.personBirthDate(name, birthDate !== null);
      // The person page's person is under the people list
      return queryClient.invalidateQueries({ queryKey: albumKeys.peopleAlbums() });
    },
  });
};
