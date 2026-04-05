import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { CancelJobResponse } from "../types";
import { JobsQueryKeys } from "./useJobsQuery";
import { WorkerQueryKeys } from "./useWorkerQuery";

export const useCancelJobMutation = () =>
  useMutation({
    mutationFn: async (id: number) => {
      const response = await fetchClient.post(`/jobs/${id}/cancel/`, {});
      return parseWithNotification(CancelJobResponse, response, "Failed to parse cancel job response");
    },
    onSuccess: () => {
      notification.jobCancelled();
      queryClient.invalidateQueries({ queryKey: [...JobsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...WorkerQueryKeys] });
    },
    onError: () => {
      notification.requestFailed("Cancel Job Failed", "Failed to cancel the job");
    },
  });
