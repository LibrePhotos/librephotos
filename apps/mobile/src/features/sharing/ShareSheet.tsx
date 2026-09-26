import { useState } from "react";
import { Modal, Pressable, Text } from "react-native";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { endpoints, useApiClient, useUserSelfDetailsQuery } from "@librephotos/api-client";
import { UserPickerSheet } from "@/components/UserPickerSheet";
import { serverAddress } from "@/lib/apiClient";
import { useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/stores/toasts";
import { useTheme } from "@/theme";

/**
 * Share actions for a set of photos (online-only, doc 05). Two paths: share to
 * another user (setPhotosShared) or make the photos public and copy the owner's
 * public-gallery link. Direct api-client calls gated by the caller's online
 * check; results surface as toasts.
 */
export function ShareSheet({
  visible,
  imageHashes,
  onClose,
}: {
  visible: boolean;
  imageHashes: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const client = useApiClient();
  const selfId = useAuthStore((s) => s.userId);
  const self = useUserSelfDetailsQuery(selfId ?? undefined);
  const pushToast = useToastStore((s) => s.push);
  const [pickingUser, setPickingUser] = useState(false);

  const shareToUser = async (userId: number) => {
    setPickingUser(false);
    onClose();
    try {
      await endpoints.setPhotosShared(client, imageHashes, userId, true);
      pushToast({ level: "info", message: t("sharing.shareSuccess") });
    } catch {
      pushToast({ level: "error", message: t("sharing.shareError") });
    }
  };

  const makePublicAndCopy = async () => {
    onClose();
    try {
      await endpoints.setPhotosPublic(client, imageHashes, true);
      const username = self.data?.username;
      if (username) {
        await Clipboard.setStringAsync(`${serverAddress()}/public/${username}`);
        pushToast({ level: "info", message: t("sharing.linkCopied") });
      } else {
        pushToast({ level: "info", message: t("sharing.shareSuccess") });
      }
    } catch {
      pushToast({ level: "error", message: t("sharing.shareError") });
    }
  };

  const revokePublic = async () => {
    onClose();
    try {
      await endpoints.setPhotosPublic(client, imageHashes, false);
      pushToast({ level: "info", message: t("sharing.shareSuccess") });
    } catch {
      pushToast({ level: "error", message: t("sharing.shareError") });
    }
  };

  return (
    <>
      <Modal visible={visible && !pickingUser} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <Pressable
            testID="share-sheet"
            onPress={() => {}}
            style={{ backgroundColor: theme.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 4 }}
          >
            <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16, marginBottom: 8 }}>{t("sharing.share")}</Text>
            <Pressable
              testID="share-with-person"
              onPress={() => setPickingUser(true)}
              style={{ paddingVertical: 14, borderBottomColor: theme.border, borderBottomWidth: 1 }}
            >
              <Text style={{ color: theme.text }}>{t("sharing.shareWith")}</Text>
            </Pressable>
            <Pressable testID="share-public-link" onPress={makePublicAndCopy} style={{ paddingVertical: 14, borderBottomColor: theme.border, borderBottomWidth: 1 }}>
              <Text style={{ color: theme.text }}>{t("sharing.makePublic")}</Text>
            </Pressable>
            <Pressable testID="share-revoke-link" onPress={revokePublic} style={{ paddingVertical: 14 }}>
              <Text style={{ color: theme.text }}>{t("sharing.makePrivate")}</Text>
            </Pressable>
            <Text style={{ color: theme.muted, fontSize: 12, marginTop: 4 }}>{t("sharing.publicNote")}</Text>
            <Pressable testID="share-sheet-cancel" onPress={onClose} style={{ paddingVertical: 14, alignItems: "center" }}>
              <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("common.cancel")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <UserPickerSheet
        visible={pickingUser}
        title={t("sharing.chooseUser")}
        onPick={(u) => void shareToUser(u.id)}
        onCancel={() => {
          setPickingUser(false);
          onClose();
        }}
      />
    </>
  );
}
