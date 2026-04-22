import { useMutation } from '@tanstack/react-query'
import { fetchClient } from '../../api'
import { tokenStorage } from '../../platform/tokenStorage'
import { platformNavigation } from '../../platform/navigation'
import { useAuthStore } from '../../../stores/authStore'

const logout = async () => {
  const refreshToken = await tokenStorage.getRefreshToken()
  if (refreshToken) {
    return fetchClient.post('/auth/token/blacklist/', {
      refresh: refreshToken,
    })
  }
}

export const useLogoutMutation = () => {
  return useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await tokenStorage.clearTokens()
      useAuthStore.getState().logout()
      platformNavigation.navigateToLogin()
    },
  })
}
