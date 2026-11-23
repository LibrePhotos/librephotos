import type { PhotoEditUpdate } from "@librephotos/api-client";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useDeletePhotoEditMutation, useSavePhotoEditMutation } from "../../../api_client/editing/photoEdits";
import { notification } from "../../../service/notifications";
import { toServerEdit, type EditSession } from "../state/session";

type Args = Readonly<{
  photoId: string;
  session: EditSession;
  /** The server saved this state. */
  onSaved: (edit: PhotoEditUpdate) => void;
  /** The edit is saved or reverted: back to the viewer. */
  onDone: () => void;
}>;

/**
 * Saving and reverting the edit. A save sends the session, marks it saved, says so and closes; a
 * failed one is reported by the QueryClient and leaves the editor open with the session as it was.
 * Revert to original asks first, then removes the edit and closes.
 */
export function useEditorPersistence({ photoId, session, onSaved, onDone }: Args) {
  const { t } = useTranslation();
  const saveMutation = useSavePhotoEditMutation();
  const deleteMutation = useDeletePhotoEditMutation();
  const [revertAsked, revertDialog] = useDisclosure(false);

  /** Save, then `after` (close the editor, or let a held navigation go). */
  const save = (after: () => void = onDone) => {
    const edit = toServerEdit(session);
    saveMutation.mutate(
      { photoId, edit },
      {
        onSuccess: () => {
          onSaved(edit);
          notification.success(t("editor.saved"));
          after();
        },
      }
    );
  };

  const revert = () =>
    deleteMutation.mutate(photoId, {
      onSuccess: () => {
        revertDialog.close();
        notification.success(t("editor.reverted"));
        onDone();
      },
    });

  return {
    save,
    saving: saveMutation.isPending,
    revert,
    reverting: deleteMutation.isPending,
    revertAsked,
    askRevert: revertDialog.open,
    cancelRevert: revertDialog.close,
  };
}
