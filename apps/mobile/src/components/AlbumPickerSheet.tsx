import { useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useReactiveQuery } from "@/db/provider";
import { userAlbums, type UserAlbumRow } from "@/db/queries/albums";
import { TextPromptModal } from "./TextPromptModal";
import { useTheme } from "@/theme";

/**
 * "Add to album" sheet: pick an existing user album (from the mirror) or create
 * a new one inline. Both paths are offline-capable — the caller wires them to
 * the outbox (add-to-album / create-album). Presentational + a live album list.
 */
export function AlbumPickerSheet({
  visible,
  onPick,
  onCreate,
  onCancel,
}: {
  visible: boolean;
  onPick: (album: { id: number; title: string }) => void;
  onCreate: (title: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const albums = useReactiveQuery<UserAlbumRow[]>((db) => userAlbums(db), []);
  const [creating, setCreating] = useState(false);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <Pressable
          testID="album-picker-sheet"
          onPress={() => {}}
          style={{ backgroundColor: theme.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: "70%", gap: 8 }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16 }}>{t("mutations.chooseAlbum")}</Text>
            <Pressable testID="album-picker-cancel" onPress={onCancel} hitSlop={8}>
              <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("mutations.cancel")}</Text>
            </Pressable>
          </View>

          <Pressable
            testID="album-picker-new"
            onPress={() => setCreating(true)}
            style={{ paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: 1 }}
          >
            <Text style={{ color: theme.brand, fontWeight: "700" }}>+ {t("mutations.newAlbum")}</Text>
          </Pressable>

          <FlatList
            data={albums.filter((a) => a.owner_id != null || a.id > 0)}
            keyExtractor={(a) => String(a.id)}
            ListEmptyComponent={
              <Text testID="album-picker-empty" style={{ color: theme.muted, paddingVertical: 16 }}>
                {t("mutations.noAlbums")}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                testID={`album-pick-${item.id}`}
                onPress={() => onPick({ id: item.id, title: item.title })}
                style={{ paddingVertical: 12, flexDirection: "row", justifyContent: "space-between" }}
              >
                <Text style={{ color: theme.text }} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 12 }}>{item.photo_count}</Text>
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>

      <TextPromptModal
        visible={creating}
        title={t("mutations.newAlbum")}
        placeholder={t("mutations.albumName")}
        submitLabel={t("mutations.create")}
        testID="new-album-prompt"
        onSubmit={(title) => {
          setCreating(false);
          if (title) onCreate(title);
        }}
        onCancel={() => setCreating(false)}
      />
    </Modal>
  );
}
