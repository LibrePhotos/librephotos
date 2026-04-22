import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient } from '../../api'
import { ManageUser } from '../types'
import { UserListQueryKeys } from './useFetchUserListQuery'
import { UserSelfDetailsQueryKeys } from './useFetchUserSelfDetailsQuery'

export type UpdateScanDirectoryRequest = {
  id: number
  scan_directory: string | null
  stack_raw_jpeg?: boolean
}

export const useUpdateUserScanDirectoryMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      scan_directory,
      stack_raw_jpeg,
    }: UpdateScanDirectoryRequest) => {
      const response = await fetchClient.patch<ManageUser>(
        `/manage/user/${id}/`,
        {
          scan_directory,
          stack_raw_jpeg,
        },
      )
      return parseWithNotification(
        ManageUser,
        response,
        'Failed to parse update user scan directory response',
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...UserListQueryKeys] })
      queryClient.invalidateQueries({ queryKey: [...UserSelfDetailsQueryKeys] })
    },
  })
}
