import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { apiClient, queryClient } from "../../api";
import { jobKeys } from "../keys";

export const useDeleteJobMutation = () =>
  useMutation({
    mutationFn: (id: number) => endpoints.deleteJob(apiClient, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
