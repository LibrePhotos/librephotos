import { endpoints, userKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";

export const useUpdateAvatarMutation = () =>
  useMutation({
    mutationFn: ({ id, data }: { id: string; data: FormData }) => endpoints.updateUserPartial(apiClient, id, data),
    onSuccess: data => {
      notification.updateUser(data.username);
      void queryClient.invalidateQueries({ queryKey: userKeys.list() });
      // Returned: the profile shows the stored picture once the upload is done, so it is done
      // when the profile has been read again, not before.
      return queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
    },
  });
