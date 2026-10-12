import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient, queryClient } from "../../api";
import { userKeys } from "../keys";
import { User } from "../types";

export const useUpdateAvatarMutation = () =>
  useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormData }) => {
      const response = await apiClient.patch(`/user/${id}/`, data);
      return parseWithNotification(User, response, "Failed to parse update avatar response");
    },
    onSuccess: data => {
      notification.updateUser(data.username);
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
