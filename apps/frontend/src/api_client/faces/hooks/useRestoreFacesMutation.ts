import { endpoints } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidateFaceEdits } from "./invalidateFaceEdits";

type RestoreFacesRequest = { faceIds: number[] };

const restoreFaces = (data: RestoreFacesRequest) => endpoints.restoreFaces(apiClient, data.faceIds);

/** Bring deleted faces back to the person each one had: the Deleted tab, and the Undo of a delete (#127). */
export const useRestoreFacesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restoreFaces,
    onSuccess: data => {
      notification.restoreFaces(data.restored_ids.length);
      invalidateFaceEdits(queryClient);
    },
  });
};
