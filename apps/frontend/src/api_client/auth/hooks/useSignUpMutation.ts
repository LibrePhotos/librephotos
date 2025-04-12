import { useMutation } from '@tanstack/react-query';
import { queryClient } from '../../api';
import { QueryKeys } from '../../api';
import { API } from '../../api';
import type { SignUpMutationVariables, SignUpMutationResponse } from '../types';

export const useSignUpMutation = () => {
  return useMutation<SignUpMutationResponse, Error, SignUpMutationVariables>({
    mutationFn: (variables) => API.signUp(variables),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.isFirstTimeSetup] });
      queryClient.invalidateQueries({ queryKey: [QueryKeys.userList] });
    }
  });
}; 