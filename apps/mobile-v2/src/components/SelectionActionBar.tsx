import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme, type ThemeColors } from "@/theme";
import { isGridActionAvailable, type GridAction } from "@/features/mutations/offline";

/**
 * Bottom action bar shown while a grid is in multi-select mode (doc 05). Offline
 * actions (favorite/hide/trash/add-to-album) are always enabled; online-only
 * actions (download/share-link/delete-permanent) render disabled with a clear
 * "needs a connection" affordance when offline. Purely presentational — it
 * dispatches to injected handlers, so it renders in isolation under test.
 */
export type SelectionActionBarProps = {
  count: number;
  isOnline: boolean;
  onFavorite: () => void;
  onHide: () => void;
  onTrash: () => void;
  onAddToAlbum: () => void;
  /** Only present in an album-detail context (remove selected from THIS album). */
  onRemoveFromAlbum?: () => void;
  onDownload?: () => void;
  onShareLink?: () => void;
  onDeletePermanent?: () => void;
  onCancel: () => void;
};

export function SelectionActionBar(props: SelectionActionBarProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const disabled = props.count === 0;

  return (
    <View
      testID="selection-action-bar"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.card,
        borderTopColor: theme.border,
        borderTopWidth: 1,
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 24,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text testID="selection-count" style={{ color: theme.text, fontWeight: "700" }}>
          {t("selection.selectedCount", { count: props.count })}
        </Text>
        <Pressable testID="selection-cancel" onPress={props.onCancel} hitSlop={8}>
          <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("selection.cancel")}</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <BarButton testID="action-favorite" label={t("selection.favorite")} onPress={props.onFavorite} disabled={disabled} theme={theme} />
        <BarButton testID="action-hide" label={t("selection.hide")} onPress={props.onHide} disabled={disabled} theme={theme} />
        <BarButton testID="action-trash" label={t("selection.trash")} onPress={props.onTrash} disabled={disabled} theme={theme} />
        <BarButton testID="action-add-album" label={t("selection.addToAlbum")} onPress={props.onAddToAlbum} disabled={disabled} theme={theme} />
        {props.onRemoveFromAlbum ? (
          <BarButton testID="action-remove-album" label={t("mutations.remove")} onPress={props.onRemoveFromAlbum} disabled={disabled} theme={theme} />
        ) : null}
        <OnlineOnlyButton action="download" testID="action-download" label={t("selection.download")} onPress={props.onDownload} isOnline={props.isOnline} disabled={disabled} theme={theme} />
        <OnlineOnlyButton action="shareLink" testID="action-share-link" label={t("selection.shareLink")} onPress={props.onShareLink} isOnline={props.isOnline} disabled={disabled} theme={theme} />
        <OnlineOnlyButton action="deletePermanent" testID="action-delete-permanent" label={t("selection.deletePermanent")} onPress={props.onDeletePermanent} isOnline={props.isOnline} disabled={disabled} theme={theme} />
      </View>
    </View>
  );
}

function BarButton({
  label,
  onPress,
  disabled,
  theme,
  testID,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  theme: ThemeColors;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled: !!disabled }}
      style={{
        opacity: disabled ? 0.4 : 1,
        backgroundColor: theme.background,
        borderColor: theme.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: theme.text, fontWeight: "600", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function OnlineOnlyButton({
  action,
  label,
  onPress,
  isOnline,
  disabled,
  theme,
  testID,
}: {
  action: GridAction;
  label: string;
  onPress?: () => void;
  isOnline: boolean;
  disabled?: boolean;
  theme: ThemeColors;
  testID: string;
}) {
  const available = isGridActionAvailable(action, isOnline);
  const off = disabled || !available;
  return (
    <Pressable
      testID={testID}
      onPress={available ? onPress : undefined}
      disabled={off}
      accessibilityState={{ disabled: off }}
      style={{
        opacity: off ? 0.4 : 1,
        backgroundColor: theme.background,
        borderColor: theme.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: available ? theme.text : theme.muted, fontWeight: "600", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}
