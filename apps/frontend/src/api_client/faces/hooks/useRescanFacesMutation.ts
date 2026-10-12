import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { startJob } from "../../jobs/startJob";

/**
 * Detect faces again in every photo (POST /scanfaces; the GET the backend still
 * answers is deprecated). A scan already queued or running is followed instead
 * of reported as a failure; the toasts are shown here, so callers just `mutate()`.
 */
export const useRescanFacesMutation = () =>
  useMutation({
    mutationFn: () => startJob(() => apiClient.post("/scanfaces", {})),
    onSuccess: start => {
      if (!start.alreadyRunning) {
        notification.rescanFaces();
      }
    },
    onError: () => notification.rescanFacesFailed(),
  });
