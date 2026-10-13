import { endpoints, folderKeys, userKeys, type User } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";

type UpdateUserOptions = {
  /** Skip the success toast, e.g. for the photo grid's debounced display preferences. */
  silent?: boolean;
};

// The option lives on the hook: TanStack Query v5 hands onSuccess the onMutate
// result as its third argument, so a per-call `context: { silent }` is never seen.
export const useUpdateUserMutation = ({ silent = false }: UpdateUserOptions = {}) =>
  useMutation({
    // PATCH: send only the fields to change. Echoing the whole profile back
    // also sends read-only values such as the avatar URL (#2153).
    mutationFn: (user: Partial<User> & Pick<User, "id">) => endpoints.updateUserPartial(apiClient, user.id, user),
    onSuccess: data => {
      if (!silent) {
        notification.updateUser(data.username);
      }
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
      queryClient.invalidateQueries({ queryKey: folderKeys.nextcloudDirs() });
    },
  });
