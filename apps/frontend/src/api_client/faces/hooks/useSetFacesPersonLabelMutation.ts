import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { PeopleAlbumsQueryKeys } from "../../albums/hooks/useFetchPeopleAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { PhotoDetailsQueryKeys } from "../../photos/hooks/useFetchPhotoDetailsQuery";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { PersonFaceList } from "../types";
import { FacesQueryKeys } from "./useFetchFacesQuery";
import { IncompleteFacesQueryKeys } from "./useFetchIncompleteFacesQuery";

export type SetFacesLabelRequest = z.infer<typeof SetFacesLabelRequest>;
export const SetFacesLabelRequest = z.object({
  faceIds: z.array(z.number()),
  personName: z.string(),
});

export type SetFacesLabelResponse = z.infer<typeof SetFacesLabelResponse>;
export const SetFacesLabelResponse = z.object({
  status: z.boolean(),
  results: PersonFaceList,
  updated: PersonFaceList,
  not_updated: PersonFaceList,
});

const setFacesPersonLabel = (data: SetFacesLabelRequest) =>
  fetchClient
    .post<SetFacesLabelResponse>("/labelfaces", {
      person_name: data.personName,
      face_ids: data.faceIds,
    })
    .then(response => {
      const payload = parseWithNotification(
        SetFacesLabelResponse,
        response,
        "Failed to parse set faces label response"
      );
      notification.addFacesToPerson(payload.results[0].person_name ?? "unknown", payload.results.length);
      return payload;
    });

export const useSetFacesPersonLabelMutation = () =>
  useMutation({
    mutationFn: setFacesPersonLabel,
    onSuccess: () => {
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
