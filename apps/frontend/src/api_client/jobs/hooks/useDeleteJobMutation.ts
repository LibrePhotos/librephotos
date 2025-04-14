import { useMutation } from '@tanstack/react-query';
import { fetchClient, queryClient, QueryKeys } from "../../api";

export const useDeleteJobMutation = () => 
  useMutation({
    mutationFn: async (id: number) => {
      await fetchClient.delete(`/jobs/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.jobs] });
    },
  }); 