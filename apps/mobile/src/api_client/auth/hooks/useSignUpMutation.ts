import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient, queryClient } from '../../api'
import { UserListQueryKeys } from '../../user/hooks/useFetchUserListQuery'
import { IsFirstTimeSetupQueryKeys } from './useIsFirstTimeSetupQuery'

export const UserSignupRequest = z.object({
  username: z.string(),
  password: z.string(),
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
})

export const UserSignupResponse = z.object({
  username: z.string(),
  email: z.string(),
  first_name: z.string(),
  last_name: z.string(),
})

export type UserSignupRequest = z.infer<typeof UserSignupRequest>
export type UserSignupResponse = z.infer<typeof UserSignupResponse>

const signUp = (data: UserSignupRequest) =>
  fetchClient
    .post<UserSignupResponse>('/user/', data)
    .then(response =>
      parseWithNotification(
        UserSignupResponse,
        response,
        'Failed to parse signup response',
      ),
    )

export const useSignUpMutation = () =>
  useMutation({
    mutationFn: signUp,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IsFirstTimeSetupQueryKeys })
      queryClient.invalidateQueries({ queryKey: UserListQueryKeys })
    },
  })
