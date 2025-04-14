import { useMutation } from '@tanstack/react-query';
import { z } from "zod";
import { fetchClient, queryClient, QueryKeys } from "../../api";
import { notification } from "../../../service/notifications";
import { User } from "../types";

export const useUpdateUserMutation = () => useMutation({
    mutationFn: async (user: User) => {
      const response = await fetchClient.patch(`/user/${user.id}/`, user);
      return User.parse(response);
    },
    onSuccess: (data) => {
      notification.updateUser(data.username);
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [QueryKeys.userSelfDetails] });
      queryClient.invalidateQueries({ queryKey: [QueryKeys.userList] });
      queryClient.invalidateQueries({ queryKey: [QueryKeys.nextcloudDirs] });
    },
  });