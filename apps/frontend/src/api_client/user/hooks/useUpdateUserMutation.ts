import { endpoints, folderKeys, userKeys, type User } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

type UpdateUserOptions = MutationErrorOptions & {
  /** Skip the success toast, e.g. for the photo grid's debounced display preferences. */
  silent?: boolean;
};

// The option lives on the hook: TanStack Query v5 hands onSuccess the onMutate
// result as its third argument, so a per-call `context: { silent }` is never seen.
export const useUpdateUserMutation = ({ silent = false, ...options }: UpdateUserOptions = {}) =>
  useMutation({
    meta: mutationErrorMeta(options),
    // PATCH: send only the fields to change. Echoing the whole profile back
    // also sends read-only values such as the avatar URL (#2153).
    mutationFn: (user: Partial<User> & Pick<User, "id">) => endpoints.updateUserPartial(apiClient, user.id, user),
    onSuccess: data => {
      if (!silent) {
        notification.updateUser(data.username);
      }
      void queryClient.invalidateQueries({ queryKey: userKeys.list() });
      void queryClient.invalidateQueries({ queryKey: folderKeys.nextcloudDirs() });
      // Returned: a settings page shows the stored profile again once the save is done, so the
      // save is done when the profile has been read again, not before.
      return queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
    },
  });
