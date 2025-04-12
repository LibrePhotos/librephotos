import { useMutation } from '@tanstack/react-query';
import { queryClient } from '../../api';
import { QueryKeys } from '../../api';
import { API } from '../../api';
import type { ManageUpdateUserMutationVariables, ManageUpdateUserMutationResponse } from '../types';

export const useManageUpdateUserMutation = () => {
  return useMutation<ManageUpdateUserMutationResponse, Error, ManageUpdateUserMutationVariables>({
    mutationFn: (variables) => API.manageUpdateUser(variables),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.userList] });
    }
  });
}; 