import { useCallback } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutations } from "@/mutations/useMutations";
import { useToastStore } from "@/stores/toasts";

/**
 * Ask, then delete a user album (photos stay). Offline-capable: the album
 * leaves the mirror at once and the delete waits in the outbox; a refusal from
 * the server (say, someone else's album) comes back as a toast on replay.
 */
export function useConfirmDeleteAlbum() {
  const { t } = useTranslation();
  const mutations = useMutations();
  const pushToast = useToastStore((s) => s.push);

  return useCallback(
    (album: { id: number; title: string }, onDeleted?: () => void) => {
      Alert.alert(t("albumDetail.deleteTitle", { title: album.title }), t("albumDetail.deleteMessage"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("albumDetail.deleteConfirm"),
          style: "destructive",
          onPress: () => {
            mutations.deleteAlbum(album.id);
            pushToast({ level: "info", message: t("albumDetail.deleted") });
            onDeleted?.();
          },
        },
      ]);
    },
    [t, mutations, pushToast]
  );
}

/** Whether the signed-in user may change a user album: their own, or one made offline (no owner yet). */
export function canManageAlbum(ownerId: number | null, userId: number | null): boolean {
  return ownerId == null || (userId != null && ownerId === userId);
}
