import { useMutation } from '@tanstack/react-query';
import { API } from '../../api';
import type { LogoutMutationVariables, LogoutMutationResponse } from '../types';

export const useLogoutMutation = () => {
  return useMutation<LogoutMutationResponse, Error, LogoutMutationVariables>({
    mutationFn: async () => {
      await API.logout();
      return undefined;
    }
  });
}; 