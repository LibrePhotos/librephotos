import { useQuery } from '@tanstack/react-query'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient } from '../../api'
import { User } from '../types'

export const UserSelfDetailsQueryKeys = ['userSelfDetails'] as const

// User Self Details Query
export const useFetchUserSelfDetailsQuery = (userId: string) =>
  useQuery<User>({
    queryKey: [...UserSelfDetailsQueryKeys, userId],
    queryFn: async () => {
      const response = await fetchClient.get<User>(`/user/${userId}/`)
      return parseWithNotification(
        User,
        response,
        'Failed to parse user self details',
      )
    },
    enabled: !!userId,
  })
