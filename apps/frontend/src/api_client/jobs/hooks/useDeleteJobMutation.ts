import { useMutation } from '@tanstack/react-query';
import { fetchClient, queryClient } from "../../api";
import { JobsQueryKeys } from './useJobsQuery';


export const useDeleteJobMutation = () => 
  useMutation({
    mutationFn: async (id: number) => {
      await fetchClient.delete(`/jobs/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...JobsQueryKeys] });
    },
  }); 