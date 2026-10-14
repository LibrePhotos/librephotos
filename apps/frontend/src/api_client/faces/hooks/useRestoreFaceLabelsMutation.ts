import { endpoints } from "@librephotos/api-client";
import type { FaceLabels } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { invalidateFaceEdits } from "./invalidateFaceEdits";

const restoreFaceLabels = (faces: readonly FaceLabels[]) => endpoints.restoreFaceLabels(apiClient, faces);

/** The Undo of a labelling: the faces get back the people they had, suggestions included (#127). */
export const useRestoreFaceLabelsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restoreFaceLabels,
    onSuccess: data => {
      notification.restoreFaceLabels(data.restored_ids.length);
      invalidateFaceEdits(queryClient);
    },
  });
};
