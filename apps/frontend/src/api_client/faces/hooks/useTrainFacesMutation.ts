import { albumKeys, endpoints, faceKeys, invalidateAfter, statsKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";

const trainFaces = () => endpoints.trainFaces(apiClient);

export const useTrainFacesMutation = () =>
  useMutation({
    mutationFn: () => trainFaces(),
    onSuccess: data => {
      // Already running: endpoints.trainFaces resolves with that job instead of a 409.
      if (data.already_running) {
        notification.jobAlreadyRunning();
      } else {
        notification.trainFaces();
      }
      // Faces clustering/training may change counts and labels
      invalidateAfter(queryClient, [
        faceKeys.incomplete(),
        faceKeys.personFaces(),
        albumKeys.peopleAlbums(),
        statsKeys.counts(),
      ]);
    },
    onError: () => {
      notification.trainFacesFailed();
    },
  });
