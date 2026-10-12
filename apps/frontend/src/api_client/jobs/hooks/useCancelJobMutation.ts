import { useMutation } from "@tanstack/react-query";
import i18n from "../../../i18n";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient, queryClient } from "../../api";
import { jobKeys } from "../keys";
import { CancelJobResponse } from "../types";

export const useCancelJobMutation = () =>
  useMutation({
    mutationFn: async (id: number) => {
      const response = await apiClient.post(`/jobs/${id}/cancel/`, {});
      return parseWithNotification(CancelJobResponse, response, "Failed to parse cancel job response");
    },
    onSuccess: () => {
      notification.jobCancelled();
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
      queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
    onError: () => {
      notification.requestFailed(i18n.t("toasts.canceljobfailedtitle"), i18n.t("toasts.canceljobfailed"));
    },
  });
