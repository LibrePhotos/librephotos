import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import { QueryKeys as UserListQueryKeys } from './useFetchUserListQuery';

// Delete User Mutation
export const useDeleteUserMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (userId: number) => {
      await fetchClient.delete(`/delete/user/${userId}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: UserListQueryKeys });
    }
  });
}; 