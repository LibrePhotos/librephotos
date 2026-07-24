import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme, type ThemeColors } from "@/theme";

/**
 * The full-screen viewer's action bar (doc 05): favorite, hide, trash/restore,
 * a 0–5 star rating row, caption edit, and add-to-album. All offline-capable
 * (they go through the outbox). Presentational — the screen owns the mirror row
 * + mutation wiring and passes state/handlers in.
 */
export type ViewerActionBarProps = {
  isFavorite: boolean;
  hidden: boolean;
  inTrashcan: boolean;
  rating: number;
  onToggleFavorite: () => void;
  onToggleHide: () => void;
  onToggleTrash: () => void;
  onRate: (rating: number) => void;
  onEditCaption: () => void;
  onAddToAlbum: () => void;
};

export function ViewerActionBar(props: ViewerActionBarProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View
      testID="viewer-action-bar"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        paddingTop: 48,
        paddingHorizontal: 12,
        paddingBottom: 10,
        gap: 8,
        backgroundColor: "rgba(0,0,0,0.35)",
      }}
    >
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <IconButton testID="viewer-favorite" label={props.isFavorite ? "★" : "☆"} active={props.isFavorite} onPress={props.onToggleFavorite} theme={theme} />
        <IconButton testID="viewer-hide" label={props.hidden ? t("selection.unhide") : t("selection.hide")} active={props.hidden} onPress={props.onToggleHide} theme={theme} />
        <IconButton
          testID="viewer-trash"
          label={props.inTrashcan ? t("selection.restore") : t("selection.trash")}
          active={props.inTrashcan}
          onPress={props.onToggleTrash}
          theme={theme}
        />
        <IconButton testID="viewer-caption" label={t("mutations.caption")} onPress={props.onEditCaption} theme={theme} />
        <IconButton testID="viewer-add-album" label={t("selection.addToAlbum")} onPress={props.onAddToAlbum} theme={theme} />
      </View>

      {/* 0–5 star rating row. */}
      <View testID="viewer-rating" style={{ flexDirection: "row", gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} testID={`viewer-star-${n}`} onPress={() => props.onRate(n === props.rating ? 0 : n)} hitSlop={6}>
            <Text style={{ fontSize: 22, color: n <= props.rating ? "#fbbf24" : "rgba(255,255,255,0.55)" }}>
              {n <= props.rating ? "★" : "☆"}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function IconButton({
  label,
  onPress,
  active,
  theme,
  testID,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  theme: ThemeColors;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        backgroundColor: active ? theme.brand : "rgba(255,255,255,0.15)",
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}
