import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { User } from "../types";
import { UserListQueryKeys } from "./useFetchUserListQuery";
import { UserSelfDetailsQueryKeys } from "./useFetchUserSelfDetailsQuery";

export const useUpdateAvatarMutation = () =>
  useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormData }) => {
      const response = await fetchClient.patch(`/user/${id}/`, data);
      return parseWithNotification(User, response, "Failed to parse update avatar response");
    },
    onSuccess: data => {
      notification.updateUser(data.username);
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [...UserSelfDetailsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...UserListQueryKeys] });
    },
  });
