import { endpoints, jobKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { apiClient, queryClient } from "../../api";

export const useDeleteJobMutation = () =>
  useMutation({
    mutationFn: (id: number) => endpoints.deleteJob(apiClient, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
