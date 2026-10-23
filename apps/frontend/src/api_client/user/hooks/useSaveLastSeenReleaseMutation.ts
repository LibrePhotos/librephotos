import { endpoints, userKeys, type User } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

type SaveLastSeenReleaseRequest = {
  userId: number;
  /** The running release's tag, which the What's new card was shown for. */
  release: string;
};

/**
 * Remembers which release's What's new card the user closed or opened (#2305), sending only
 * `last_seen_release`. Not useUpdateUserMutation: that one toasts "user updated" and refetches the
 * user list. The cached user changes at once, so the card is gone before the answer comes.
 */
export const useSaveLastSeenReleaseMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  const putInCache = (userId: number, change: (user: User) => User) =>
    queryClient.setQueriesData({ queryKey: userKeys.selfDetails() }, (old: User | undefined) =>
      old?.id === userId ? change(old) : old
    );
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ userId, release }: SaveLastSeenReleaseRequest) =>
      endpoints.updateUserPartial(apiClient, userId, { last_seen_release: release }),
    onMutate: ({ userId, release }) => {
      putInCache(userId, user => ({ ...user, last_seen_release: release }));
    },
    onSuccess: user => {
      putInCache(user.id, () => user);
    },
  });
};
