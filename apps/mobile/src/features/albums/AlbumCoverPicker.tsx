import { useMemo } from "react";
import { FlatList, Modal, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { mediaHeaders, squareThumbnailUrl } from "@librephotos/api-client";
import { Icon } from "@/components/Icon";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { useTheme } from "@/theme";

export type CoverCandidate = { photoId: string; imageHash: string };

const COLUMNS = 4;

/**
 * Pick a user album's cover from its photos, or go back to the automatic one
 * (the web's AlbumCoverPickerModal). The current explicit cover is checked;
 * with none, "Automatic" is.
 */
export function AlbumCoverPicker({
  visible,
  photos,
  currentCoverHash,
  onPick,
  onClose,
}: {
  visible: boolean;
  photos: CoverCandidate[];
  /** The explicit cover in use; null while it is automatic. */
  currentCoverHash: string | null;
  /** `null` = automatic. */
  onPick: (photo: CoverCandidate | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const token = useAccessToken();
  const base = serverAddress();
  const headers = useMemo(() => mediaHeaders(token), [token]);
  const { width } = useWindowDimensions();
  const size = Math.floor((width - 32 - (COLUMNS - 1) * 4) / COLUMNS);
  const automatic = currentCoverHash == null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <Pressable
          testID="album-cover-picker"
          onPress={() => {}}
          style={{
            backgroundColor: theme.card,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            padding: 16,
            paddingBottom: 28,
            maxHeight: "80%",
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16 }}>{t("albumDetail.chooseCover")}</Text>
            <Pressable testID="album-cover-picker-cancel" onPress={onClose} hitSlop={8}>
              <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
          <Pressable
            testID="album-cover-automatic"
            accessibilityRole="button"
            accessibilityState={{ selected: automatic }}
            onPress={() => onPick(null)}
            style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12 }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 15 }}>{t("albumDetail.automaticCover")}</Text>
              <Text style={{ color: theme.muted, fontSize: 12 }}>{t("albumDetail.automaticCoverHint")}</Text>
            </View>
            {automatic ? <Icon name="check" size={20} color={theme.brand} /> : null}
          </Pressable>
          <FlatList
            data={photos}
            numColumns={COLUMNS}
            keyExtractor={(p) => p.photoId}
            columnWrapperStyle={{ gap: 4 }}
            contentContainerStyle={{ gap: 4 }}
            ListEmptyComponent={<Text style={{ color: theme.muted }}>{t("albumDetail.empty")}</Text>}
            renderItem={({ item }) => {
              const selected = item.imageHash === currentCoverHash;
              return (
                <Pressable
                  testID={`album-cover-option-${item.photoId}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onPick(item)}
                >
                  <Image
                    style={{
                      width: size,
                      height: size,
                      borderRadius: 6,
                      backgroundColor: theme.background,
                      borderWidth: selected ? 3 : 0,
                      borderColor: theme.brand,
                    }}
                    source={{ uri: squareThumbnailUrl(base, item.imageHash), headers }}
                    contentFit="cover"
                    cachePolicy="disk"
                  />
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
