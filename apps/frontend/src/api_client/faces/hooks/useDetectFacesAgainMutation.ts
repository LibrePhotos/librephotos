import { endpoints, jobKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import i18n from "../../../i18n";
import { notification } from "../../../service/notifications";
import { apiClient, ApiError } from "../../api";
import { startJob } from "../../jobs/startJob";
import { detectFacesReports } from "../detectFacesReports";

/** Where to detect faces again: one folder and those below it, or some photos (`Photo.id`s). */
export type DetectFacesScope = { path: string } | { photo_ids: readonly string[] };

/** A scan of one photo is followed, so its People section can say what it found (#1117). */
function followOnePhoto(scope: DetectFacesScope, jobId: string | undefined) {
  if ("photo_ids" in scope && scope.photo_ids.length === 1 && scope.photo_ids[0] && jobId) {
    detectFacesReports.start(scope.photo_ids[0], jobId);
  }
}

/**
 * Detect faces again in one folder or in some photos (#524); the Library page's Rescan Faces does
 * the whole library. Faces already found stay, and deleted ones are not found again. Shows its
 * own toasts, so callers just `mutate(scope)`.
 */
export function useDetectFacesAgainMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scope: DetectFacesScope) => startJob(() => endpoints.scanFaces(apiClient, scope)),
    onSuccess: (start, scope) => {
      if (!start.alreadyRunning) {
        notification.detectFacesAgain("path" in scope ? null : scope.photo_ids.length);
        followOnePhoto(scope, start.data.job_id);
      }
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
    onError: error => {
      // The client already reports a 401 and a 500.
      if (error instanceof ApiError && (error.status === 401 || error.status === 500)) return;
      notification.detectFacesAgainFailed(
        (error instanceof ApiError && error.serverMessage) || i18n.t("toasts.rescanfacesfailed")
      );
    },
  });
}
