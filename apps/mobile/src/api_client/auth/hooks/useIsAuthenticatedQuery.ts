import { useQuery } from '@tanstack/react-query'
import { tokenStorage } from '../../platform/tokenStorage'

export const IsAuthenticatedQueryKeys = ['isAuthenticated']

export const useIsAuthenticatedQuery = () =>
  useQuery({
    queryKey: IsAuthenticatedQueryKeys,
    queryFn: async () => {
      const token = await tokenStorage.getAccessToken()
      return !!token
    },
  })
