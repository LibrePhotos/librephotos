import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient } from '../../api'
import { ManageUser } from '../types'
import { UserListQueryKeys } from './useFetchUserListQuery'

// Manage Update User Mutation
export const useManageUpdateUserMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: ManageUser) => {
      const response = await fetchClient.patch<ManageUser>(
        `/manage/user/${data.id}/`,
        data,
      )
      return parseWithNotification(
        ManageUser,
        response,
        'Failed to parse manage update user response',
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...UserListQueryKeys] })
    },
  })
}
