import { endpoints, userKeys, type User } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

/** What the support prompts remember: the thank-you dialog was seen, or the year whose Rewind was. */
type SupportPromptState = Partial<Pick<User, "support_prompt_seen" | "rewind_seen_year">>;

type SaveSupportPromptStateRequest = {
  userId: number;
  state: SupportPromptState;
};

/**
 * Remembers that the user closed the thank-you dialog or a year's Rewind, sending only those fields.
 * Like useSaveLastSeenReleaseMutation: no toast, and the cached user changes at once, so the dialog
 * does not come back while the answer is on its way.
 */
export const useSaveSupportPromptStateMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  const putInCache = (userId: number, change: (user: User) => User) =>
    queryClient.setQueriesData({ queryKey: userKeys.selfDetails() }, (old: User | undefined) =>
      old?.id === userId ? change(old) : old
    );
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ userId, state }: SaveSupportPromptStateRequest) =>
      endpoints.updateUserPartial(apiClient, userId, state),
    onMutate: ({ userId, state }) => {
      putInCache(userId, user => ({ ...user, ...state }));
    },
    onSuccess: user => {
      putInCache(user.id, () => user);
    },
  });
};
