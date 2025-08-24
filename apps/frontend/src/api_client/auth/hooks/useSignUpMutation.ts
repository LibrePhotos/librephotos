import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { fetchClient, queryClient } from '../../api';

import { IsFirstTimeSetupQueryKeys } from './useIsFirstTimeSetupQuery';
import { UserListQueryKeys } from '../../user/hooks/useFetchUserListQuery';





export const UserSignupRequest = z.object({
  username: z.string(),
  password: z.string(), 
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
});

export const UserSignupResponse = z.object({
  username: z.string(),
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
});

export type UserSignupRequest = z.infer<typeof UserSignupRequest>;
export type UserSignupResponse = z.infer<typeof UserSignupResponse>;

const signUp = (data: UserSignupRequest) => 
  fetchClient.post<UserSignupResponse>('/user/', data)
    .then(response => UserSignupResponse.parse(response))

export const useSignUpMutation = () => useMutation({
    mutationFn: signUp,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IsFirstTimeSetupQueryKeys });
      queryClient.invalidateQueries({ queryKey: UserListQueryKeys });
    }
  }); 