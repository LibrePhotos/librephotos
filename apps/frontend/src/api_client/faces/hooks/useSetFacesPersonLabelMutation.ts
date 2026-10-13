import { albumKeys, endpoints, faceKeys, invalidateAfter, photoKeys, statsKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { recordRecentlyTaggedPerson } from "../../../util/recentlyTaggedPeople";
import { apiClient, queryClient } from "../../api";

type SetFacesLabelRequest = { faceIds: number[]; personName: string };

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

      // Face-related queries, people albums (face counts and labels change), statistics (num_faces,
      // num_people, etc. change) and photo details (people array changes), after a short delay
      // so backend processing is complete.
      invalidateAfter(queryClient, [
        faceKeys.incomplete(),
        faceKeys.personFaces(),
        albumKeys.peopleAlbums(),
        statsKeys.counts(),
        photoKeys.details(),
      ]);
    },
  });
