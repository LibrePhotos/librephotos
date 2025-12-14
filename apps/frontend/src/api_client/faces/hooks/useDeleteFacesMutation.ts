import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { PeopleAlbumsQueryKeys } from "../../albums/hooks/useFetchPeopleAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { PhotoDetailsQueryKeys } from "../../photos/hooks/useFetchPhotoDetailsQuery";
import { FacesQueryKeys } from "./useFetchFacesQuery";
import { IncompleteFacesQueryKeys } from "./useFetchIncompleteFacesQuery";

export const DeleteFacesQueryKeys = ["deleteFaces"];

export type DeleteFacesRequest = z.infer<typeof DeleteFacesRequest>;
export const DeleteFacesRequest = z.object({
  faceIds: z.array(z.number()),
});

export type DeleteFacesResponse = z.infer<typeof DeleteFacesResponse>;
// To-Do: Should be siilar to SetFacesLabelResponse
export const DeleteFacesResponse = z.object({
  status: z.boolean(),
  results: z.array(z.string()),
  deleted: z.array(z.string()),
  not_deleted: z.array(z.string()),
});

const deleteFaces = (data: DeleteFacesRequest) =>
  fetchClient
    .post<DeleteFacesResponse>("/deletefaces", { face_ids: data.faceIds })
    .then(response => DeleteFacesResponse.parse(response));

export const useDeleteFacesMutation = () =>
  useMutation({
    mutationKey: [...DeleteFacesQueryKeys],
    mutationFn: deleteFaces,
    onSuccess: () => {
      // Add a small delay to ensure backend processing is complete
      setTimeout(() => {
        // Invalidate all face-related queries
        queryClient.invalidateQueries({ queryKey: IncompleteFacesQueryKeys });
        queryClient.invalidateQueries({ queryKey: FacesQueryKeys });

        // Invalidate people albums (face counts change)
        queryClient.invalidateQueries({ queryKey: PeopleAlbumsQueryKeys });

        // Invalidate statistics (num_faces, num_people, etc. change)
        queryClient.invalidateQueries({ queryKey: CountStatsQueryKeys });

        // Invalidate photo details (people array changes)
        queryClient.invalidateQueries({ queryKey: PhotoDetailsQueryKeys });
      }, 100);
    },
    onError: error => {
      // eslint-disable-next-line no-console
      console.error("Delete faces mutation error:", error);
    },
  });
