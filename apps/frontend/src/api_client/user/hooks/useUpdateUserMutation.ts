import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { folderKeys } from "../../folders/keys";
import { userKeys } from "../keys";
import { User } from "../types";

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
    mutationFn: async (user: Partial<User> & Pick<User, "id">) => {
      const response = await fetchClient.patch(`/user/${user.id}/`, user);
      return parseWithNotification(User, response, "Failed to parse update user response");
    },
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
