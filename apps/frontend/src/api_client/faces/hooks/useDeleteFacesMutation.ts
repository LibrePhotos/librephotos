import { endpoints } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidateFaceEdits } from "./invalidateFaceEdits";
import { useRestoreFacesMutation } from "./useRestoreFacesMutation";

const DeleteFacesMutationKey = ["deleteFaces"] as const;

type DeleteFacesRequest = { faceIds: number[] };

const deleteFaces = (data: DeleteFacesRequest) => endpoints.deleteFaces(apiClient, data.faceIds);

export const useDeleteFacesMutation = () => {
  const queryClient = useQueryClient();
  // The toast's Undo restores the faces (#127); it outlives the component that deleted them
  const { mutateAsync: restoreFaces } = useRestoreFacesMutation();
  return useMutation({
    mutationKey: DeleteFacesMutationKey,
    mutationFn: deleteFaces,
    // Only once the server confirmed: the dashboard and the lightbox used to say so right after
    // sending the request. A failure gets the QueryClient's "could not save" toast.
    onSuccess: (data, { faceIds }) => {
      // Older servers do not say which faces they deleted: the ones asked for, then
      const deletedIds = data.deleted_ids ?? faceIds;
      notification.deleteFaces(faceIds.length, () => restoreFaces({ faceIds: deletedIds }));
      invalidateFaceEdits(queryClient);
    },
  });
};
