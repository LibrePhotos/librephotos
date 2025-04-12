import { useMutation } from '@tanstack/react-query';
import { z } from "zod";
import { fetchClient, queryClient, QueryKeys } from "../../api";
import { notification } from "../../../service/notifications";
import { UserSchema } from "../types";

type User = z.infer<typeof UserSchema>;

export const useUpdateUserMutation = () => useMutation({
    mutationFn: async (user: User) => {
      const response = await fetchClient.patch(`/user/${user.id}/`, user);
      return UserSchema.parse(response);
    },
    onSuccess: (data) => {
      notification.updateUser(data.username);
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [QueryKeys.userSelfDetails] });
      queryClient.invalidateQueries({ queryKey: [QueryKeys.userList] });
      queryClient.invalidateQueries({ queryKey: [QueryKeys.nextcloudDirs] });
    },
  });