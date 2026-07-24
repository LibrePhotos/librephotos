import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useUserListQuery } from "@librephotos/api-client";
import { useAuthStore } from "@/stores/auth";
import { useTheme } from "@/theme";

export type ShareTargetUser = { id: number; label: string };

/**
 * A bottom sheet listing the server's other users to share to (online).
 * Excludes the signed-in user. Presentational + one online query.
 */
export function UserPickerSheet({
  visible,
  title,
  onPick,
  onCancel,
}: {
  visible: boolean;
  title: string;
  onPick: (user: ShareTargetUser) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const selfId = useAuthStore((s) => s.userId);
  const users = useUserListQuery();

  const others = (users.data ?? []).filter((u) => u.id !== selfId);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <Pressable
          testID="user-picker-sheet"
          onPress={() => {}}
          style={{ backgroundColor: theme.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: "70%", gap: 8 }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16 }}>{title}</Text>
            <Pressable testID="user-picker-cancel" onPress={onCancel} hitSlop={8}>
              <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
          <FlatList
            data={others}
            keyExtractor={(u) => String(u.id)}
            ListEmptyComponent={
              <Text testID="user-picker-empty" style={{ color: theme.muted, paddingVertical: 16 }}>
                {t("sharing.noUsers")}
              </Text>
            }
            renderItem={({ item }) => {
              const label =
                `${item.first_name ?? ""} ${item.last_name ?? ""}`.trim() || item.username;
              return (
                <Pressable
                  testID={`user-pick-${item.id}`}
                  onPress={() => onPick({ id: item.id, label })}
                  style={{ paddingVertical: 14, borderBottomColor: theme.border, borderBottomWidth: 1 }}
                >
                  <Text style={{ color: theme.text }}>{label}</Text>
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
