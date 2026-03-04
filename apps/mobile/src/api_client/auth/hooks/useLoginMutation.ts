import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient } from '../../api'
import { tokenStorage } from '../../platform/tokenStorage'
import { platformNavigation } from '../../platform/navigation'
import { useAuthStore } from '../../../stores/authStore'

export const LoginPost = z.object({
  username: z.string(),
  password: z.string(),
})

export type LoginPost = z.infer<typeof LoginPost>

export const LoginResponse = z.object({
  refresh: z.string(),
  access: z.string(),
})

export type LoginResponse = z.infer<typeof LoginResponse>

const login = (credentials: LoginPost) =>
  fetchClient
    .post<LoginResponse>('/auth/token/obtain/', credentials)
    .then(async response => {
      const data = parseWithNotification(
        LoginResponse,
        response,
        'Failed to parse login response',
      )
      await tokenStorage.setTokens(data.access, data.refresh)
      useAuthStore.getState().setTokens(data)
      return data
    })

type UseLoginOptions = {
  navigateOnSuccess?: boolean
}

export const useLoginMutation = (options?: UseLoginOptions) => {
  const queryClient = useQueryClient()
  const navigateOnSuccess = options?.navigateOnSuccess ?? true

  return useMutation({
    mutationFn: login,
    onSuccess: () => {
      queryClient.invalidateQueries()
      if (navigateOnSuccess) {
        platformNavigation.navigateToHome()
      }
    },
  })
}
