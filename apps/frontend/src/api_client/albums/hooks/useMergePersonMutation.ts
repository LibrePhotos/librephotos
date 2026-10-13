import { albumKeys, endpoints, faceKeys, photoGridKeys, photoKeys, Photoset, statsKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";

type MergePersonParams = {
  /** The person who stays: keeps their name and cover. */
  targetId: string;
  targetName: string;
  /** The person merged away: their faces move to the target and they are deleted. */
  sourceId: string;
  sourceName: string;
};

/**
 * Merge one person into another (#2206): the source's faces move to the target, so the target's
 * page, count and faces change and the source leaves the people list.
 */
export const useMergePersonMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ targetId, sourceId }: MergePersonParams) => endpoints.mergePerson(apiClient, targetId, sourceId),
    onSuccess: (_result, { sourceName, targetName }) => {
      notification.mergePerson(sourceName, targetName);
      // Not awaited: the person page moves on to the target right away, and waiting would
      // refetch the merged person's page first.
      void Promise.all(
        [
          photoGridKeys.dateAlbumLists(Photoset.PERSON),
          photoGridKeys.dateAlbumDays(Photoset.PERSON),
          albumKeys.peopleAlbums(),
          faceKeys.personFaces(),
          faceKeys.incomplete(),
          statsKeys.counts(),
          photoKeys.details(),
        ].map(queryKey => queryClient.invalidateQueries({ queryKey }))
      );
    },
  });
};
