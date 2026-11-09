import type { User } from "@librephotos/api-client";
import { isEqual } from "lodash-es";
import { useUpdateUserMutation } from "../../api_client/user/hooks";
import { useServerDraft } from "../../hooks/useServerDraft";
import { reportUserSaveError } from "../../util/apiErrors";

/**
 * The user's settings as a page edits them before its "Save changes?" prompt saves them all: the
 * stored profile until something is edited, then the edits, which a fetch of the profile (window
 * focus, another save) leaves alone. A refused save is reported and keeps the edits to fix.
 * `pending` is what the prompt shows for: edits that differ from the stored profile.
 */
export function useUserSettingsDraft(stored: User | undefined) {
  const updateUser = useUpdateUserMutation({ reportsErrors: true });
  const draft = useServerDraft(stored, {
    save: async user => {
      if (!user) return true;
      const { scan_directory: _scanDirectory, avatar: _avatar, ...changes } = user;
      try {
        await updateUser.mutateAsync(changes);
        return true;
      } catch (error) {
        reportUserSaveError(error);
        return false;
      }
    },
    isEqual,
    keepOnFailure: true,
  });

  return {
    user: draft.value,
    pending: draft.dirty,
    saving: draft.status === "saving",
    edit: (update: (user: User) => User) => draft.update(user => (user ? update(user) : user)),
    save: () => draft.commit(),
    discard: draft.discard,
  };
}
