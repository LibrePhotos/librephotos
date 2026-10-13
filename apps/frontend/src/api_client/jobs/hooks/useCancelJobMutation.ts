import { endpoints, jobKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import i18n from "../../../i18n";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";

export const useCancelJobMutation = () =>
  useMutation({
    mutationFn: (id: number) => endpoints.cancelJob(apiClient, id),
    onSuccess: () => {
      notification.jobCancelled();
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
      queryClient.invalidateQueries({ queryKey: jobKeys.worker() });
    },
    onError: () => {
      notification.requestFailed(i18n.t("toasts.canceljobfailedtitle"), i18n.t("toasts.canceljobfailed"));
    },
  });
