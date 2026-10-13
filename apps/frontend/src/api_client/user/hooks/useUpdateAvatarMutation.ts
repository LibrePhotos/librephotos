import { endpoints, userKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";

export const useUpdateAvatarMutation = () =>
  useMutation({
    mutationFn: ({ id, data }: { id: string; data: FormData }) => endpoints.updateUserPartial(apiClient, id, data),
    onSuccess: data => {
      notification.updateUser(data.username);
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
