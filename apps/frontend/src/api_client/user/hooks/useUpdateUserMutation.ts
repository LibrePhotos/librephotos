import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { NextcloudDirsQueryKeys } from "../../folders/hooks/useFetchNextcloudDirsQuery";
import { User } from "../types";
import { UserListQueryKeys } from "./useFetchUserListQuery";
import { UserSelfDetailsQueryKeys } from "./useFetchUserSelfDetailsQuery";

type UpdateUserContext = {
  silent?: boolean;
};

export const useUpdateUserMutation = () =>
  useMutation({
    mutationFn: async (user: User) => {
      const response = await fetchClient.patch(`/user/${user.id}/`, user);
      return parseWithNotification(User, response, "Failed to parse update user response");
    },
    onSuccess: (data, _variables, context?: UpdateUserContext) => {
      if (!context?.silent) {
        notification.updateUser(data.username);
      }
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [...UserSelfDetailsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...UserListQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...NextcloudDirsQueryKeys] });
    },
  });
