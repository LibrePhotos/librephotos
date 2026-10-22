import { albumKeys, endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../api";
import type { Person } from "./useFetchPeopleAlbumsQuery";

/**
 * One person, shaped like a row of the people list, or `null` when the id is unknown or another
 * user's (404): the person page shows "Person not found" instead of loading for good.
 */
export const useFetchPersonQuery = (id: number) =>
  useQuery({
    queryKey: albumKeys.person(id),
    enabled: Number.isInteger(id) && id > 0,
    retry: false,
    queryFn: async (): Promise<Person | null> => {
      try {
        const person = await endpoints.fetchPerson(apiClient, id);
        return {
          id: person.id.toString(),
          name: person.name,
          video: !!person.video,
          face_count: person.face_count,
          face_photo_url: person.face_photo_url ?? "",
          face_url: person.face_url ?? "",
          group_ids: person.group_ids ?? [],
          birth_date: person.birth_date ?? null,
        };
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
