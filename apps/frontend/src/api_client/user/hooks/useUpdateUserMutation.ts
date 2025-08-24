import { useMutation } from '@tanstack/react-query';
import { fetchClient, queryClient } from "../../api";
import { notification } from "../../../service/notifications";
import { User } from "../types";
import { UserSelfDetailsQueryKeys } from './useFetchUserSelfDetailsQuery';
import { UserListQueryKeys } from './useFetchUserListQuery';
import { NextcloudDirsQueryKeys } from "../../folders/hooks/useFetchNextcloudDirsQuery";

export const useUpdateUserMutation = () => useMutation({
    mutationFn: async (user: User) => {
      const response = await fetchClient.patch(`/user/${user.id}/`, user);
      return User.parse(response);
    },
    onSuccess: (data) => {
      notification.updateUser(data.username);
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [...UserSelfDetailsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...UserListQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...NextcloudDirsQueryKeys] });
    },
  });