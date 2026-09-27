import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { recordRecentlyTaggedPerson } from "../../../util/recentlyTaggedPeople";
import { PeopleAlbumsQueryKeys } from "../../albums/hooks/useFetchPeopleAlbumsQuery";
import { apiClient, queryClient } from "../../api";
import { PhotoDetailsQueryKeys } from "../../photos/hooks/useFetchPhotoDetailsQuery";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { FacesQueryKeys } from "./useFetchFacesQuery";
import { IncompleteFacesQueryKeys } from "./useFetchIncompleteFacesQuery";

export type SetFacesLabelRequest = z.infer<typeof SetFacesLabelRequest>;
export const SetFacesLabelRequest = z.object({
  faceIds: z.array(z.number()),
  personName: z.string(),
});

export { SetFacesLabelResponse } from "@librephotos/api-client";

const setFacesPersonLabel = (data: SetFacesLabelRequest) =>
  endpoints.labelFaces(apiClient, data.faceIds, data.personName).then(payload => {
    notification.addFacesToPerson(payload.results[0]?.person_name ?? "unknown", payload.results.length);
    return payload;
  });

export const useSetFacesPersonLabelMutation = () =>
  useMutation({
    mutationFn: setFacesPersonLabel,
    onSuccess: data => {
      // Every tagging path funnels through this mutation, so this is the one
      // place that sees all of them. `person` is null when faces are pushed back
      // to "Unknown - Other", which is not a pick worth remembering.
      recordRecentlyTaggedPerson(data.results[0]?.person);

      // Add a small delay to ensure backend processing is complete
      setTimeout(() => {
        // Invalidate all face-related queries
        queryClient.invalidateQueries({ queryKey: IncompleteFacesQueryKeys });
        queryClient.invalidateQueries({ queryKey: FacesQueryKeys });

        // Invalidate people albums (face counts and labels change)
        queryClient.invalidateQueries({ queryKey: PeopleAlbumsQueryKeys });

        // Invalidate statistics (num_faces, num_people, etc. change)
        queryClient.invalidateQueries({ queryKey: CountStatsQueryKeys });

        // Invalidate photo details (people array changes)
        queryClient.invalidateQueries({ queryKey: PhotoDetailsQueryKeys });
      }, 100);
    },
  });
