import { useMutation } from '@tanstack/react-query';
import { API } from '../../api';
import type { LoginMutationVariables, LoginMutationResponse } from '../types';

export const useLoginMutation = () => {
  return useMutation<LoginMutationResponse, Error, LoginMutationVariables>({
    mutationFn: (variables) => API.login(variables)
  });
}; 