import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { PeopleAlbumsQueryKeys } from "../../albums/hooks/useFetchPeopleAlbumsQuery";
import { apiClient, queryClient } from "../../api";
import { PhotoDetailsQueryKeys } from "../../photos/hooks/useFetchPhotoDetailsQuery";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { FacesQueryKeys } from "./useFetchFacesQuery";
import { IncompleteFacesQueryKeys } from "./useFetchIncompleteFacesQuery";

export const DeleteFacesQueryKeys = ["deleteFaces"];

export type DeleteFacesRequest = z.infer<typeof DeleteFacesRequest>;
export const DeleteFacesRequest = z.object({
  faceIds: z.array(z.number()),
});

export { DeleteFacesResponse } from "@librephotos/api-client";

const deleteFaces = (data: DeleteFacesRequest) => endpoints.deleteFaces(apiClient, data.faceIds);

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
