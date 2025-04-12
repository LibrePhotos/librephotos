import { useMutation } from '@tanstack/react-query';
import { queryClient } from '../../api';
import { QueryKeys } from '../../api';
import { API } from '../../api';
import type { DeleteUserMutationVariables, DeleteUserMutationResponse } from '../types';

export const useDeleteUserMutation = () => {
  return useMutation<DeleteUserMutationResponse, Error, DeleteUserMutationVariables>({
    mutationFn: async (variables) => {
      await API.deleteUser(variables);
      return undefined;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.userList] });
    }
  });
}; 