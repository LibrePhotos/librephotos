import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient } from '../../api'
import type { ListUserList } from '../types'
import { ListUser } from '../types'

export const UserListQueryKeys = ['userList'] as const

export const UserListResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  // Non-admins receive the public-safe subset, so validate each row leniently
  // (see ListUser) instead of against the full User schema (issue #1888).
  results: z.array(ListUser),
})
// User List Query
export const useFetchUserListQuery = (skip: boolean = false) =>
  useQuery<ListUserList>({
    queryKey: UserListQueryKeys,
    queryFn: async () => {
      const response = await fetchClient.get<ListUserList>('/user/')
      return parseWithNotification(
        UserListResponse,
        response,
        'Failed to parse user list',
      ).results
    },
    enabled: !skip,
  })
