import { useTranslation } from "react-i18next";
import { notification } from "../../../service/notifications";
import { readStored, STORAGE_KEYS, writeStored } from "../../../util/storage";
import { CopiedLookSchema, lookOf, pasteLook } from "../state/copyLook";
import type { EditSession } from "../state/session";
import type { SessionCommands } from "../state/useEditSession";

/**
 * Copy settings and Paste settings (the ⋮, Ctrl+Shift+C and Ctrl+Shift+V): copy keeps the look of
 * the recipe on screen (everything but its geometry) in the browser, paste puts the copied look on
 * this photo as one `paste` step, keeping this photo's framing. Pasting with nothing copied says so.
 */
export function useCopyPaste(session: EditSession, commands: SessionCommands) {
  const { t } = useTranslation();
  return {
    copy: () => {
      writeStored(STORAGE_KEYS.editorCopiedLook, lookOf(session.committed));
      notification.success(t("editor.copyPaste.copied"));
    },
    paste: () => {
      // Read when pasting: the look may have been copied in another editor or tab since this one opened.
      const look = readStored(STORAGE_KEYS.editorCopiedLook, CopiedLookSchema, null);
      if (look === null) {
        notification.warning(t("editor.copyPaste.nothing"));
        return;
      }
      commands.apply("paste", pasteLook(session.committed, look));
    },
  };
}
