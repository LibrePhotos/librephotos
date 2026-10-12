import { useMutation } from "@tanstack/react-query";
import { apiClient, queryClient } from "../../api";
import { jobKeys } from "../keys";

export const useDeleteJobMutation = () =>
  useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/jobs/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
