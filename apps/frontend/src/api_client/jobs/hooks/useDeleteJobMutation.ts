import { useMutation } from "@tanstack/react-query";
import { fetchClient, queryClient } from "../../api";
import { jobKeys } from "../keys";

export const useDeleteJobMutation = () =>
  useMutation({
    mutationFn: async (id: number) => {
      await fetchClient.delete(`/jobs/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
