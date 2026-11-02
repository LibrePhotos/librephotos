import { useCallback } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { useApiClient } from "@librephotos/api-client";
import { useDb } from "@/db/provider";
import { serverAddress } from "@/lib/apiClient";
import { tokenStorage } from "@/lib/tokenStorage";
import { useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/stores/toasts";
import { runSync } from "@/sync/run";
import { deletePhotosPermanently } from "./deletePermanently";
import { saveToDevice } from "./saveToDevice";

/**
 * The selection bar's online-only actions (doc 05): save to the phone's gallery
 * and delete for good. Both talk to the server directly, so the bar disables
 * them while offline (`isGridActionAvailable`); results surface as toasts, as
 * the share sheet's do.
 */
export function useOnlineSelectionActions() {
  const { t } = useTranslation();
  const client = useApiClient();
  const db = useDb();
  const userId = useAuthStore((s) => s.userId);
  const pushToast = useToastStore((s) => s.push);

  const saveToPhone = useCallback(
    async (imageHashes: string[]) => {
      const count = imageHashes.length;
      if (count === 0) return;
      pushToast({ level: "info", message: t("selection.downloadStarted", { count }) });
      try {
        const accessToken = await Promise.resolve(tokenStorage.getAccessToken());
        const result = await saveToDevice({ imageHashes, serverAddress: serverAddress(), accessToken });
        if (result.kind === "permissionDenied") {
          pushToast({ level: "error", message: t("selection.downloadPermission") });
        } else if (result.failed === 0) {
          pushToast({ level: "info", message: t("selection.downloadDone", { count: result.saved }) });
        } else if (result.saved > 0) {
          pushToast({
            level: "error",
            message: t("selection.downloadPartial", { count, saved: result.saved, failed: result.failed }),
          });
        } else {
          pushToast({ level: "error", message: t("selection.downloadFailed") });
        }
      } catch {
        pushToast({ level: "error", message: t("selection.downloadFailed") });
      }
    },
    [t, pushToast]
  );

  const deletePermanently = useCallback(
    async (imageHashes: string[]) => {
      try {
        const result = await deletePhotosPermanently(client, db, userId, imageHashes);
        if (result.deleted > 0) {
          pushToast({ level: "info", message: t("selection.deletePermanentDone", { count: result.deleted }) });
        }
        if (result.notDeleted > 0) {
          pushToast({ level: "error", message: t("selection.deletePermanentSkipped", { count: result.notDeleted }) });
        }
        // Pull the server's tombstones (and its new counts) into the mirror.
        if (userId != null) void runSync(db, { userId, reason: "manual" });
      } catch {
        pushToast({ level: "error", message: t("selection.deletePermanentFailed") });
      }
    },
    [client, db, userId, t, pushToast]
  );

  /**
   * Ask first: deleting for good takes the files with it and cannot be undone.
   * `onConfirmed` runs when the user agreed (the grid leaves selection mode).
   */
  const confirmDeletePermanently = useCallback(
    (imageHashes: string[], onConfirmed: () => void) => {
      const count = imageHashes.length;
      if (count === 0) return;
      Alert.alert(
        t("selection.deletePermanentTitle", { count }),
        t("selection.deletePermanentMessage", { count }),
        [
          { text: t("selection.cancel"), style: "cancel" },
          {
            text: t("selection.deletePermanentConfirm"),
            style: "destructive",
            onPress: () => {
              onConfirmed();
              void deletePermanently(imageHashes);
            },
          },
        ]
      );
    },
    [t, deletePermanently]
  );

  return { saveToPhone, confirmDeletePermanently };
}
