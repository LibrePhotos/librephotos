import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme, type ThemeColors } from "@/theme";
import { isGridActionAvailable, type GridAction } from "@/features/mutations/offline";
import { Icon, type IconName } from "./Icon";
import { OptionSheet, type SheetOption } from "./OptionSheet";

/**
 * Bottom action bar shown while a grid is in multi-select mode (doc 05). The
 * everyday actions (favorite, add to album, share, trash) sit in the bar; the
 * rest (hide, archive, rating, set as cover, download, delete permanently) are
 * one tap away behind "More", in a sheet, so the bar stays one row on a phone.
 *
 * Offline actions (everything the outbox carries) are always enabled; online-
 * only actions (download/share/delete-permanent) render disabled with a clear
 * "needs a connection" affordance when offline. An action whose handler is left
 * out is not offered at all (nothing to save to the phone, delete-permanent
 * outside the Trash, set-cover outside an album), so the bar never shows a dead
 * button. Purely presentational — it dispatches to injected handlers, so it
 * renders in isolation under test.
 */
/** A screen's own action in the "More" sheet (a person page's "Remove from person"). */
export type SelectionExtraAction = {
  key: string;
  label: string;
  icon?: IconName;
  destructive?: boolean;
  /** Talks to the server directly: disabled, with the reason, while offline. */
  onlineOnly?: boolean;
  onPress: () => void;
};

export type SelectionActionBarProps = {
  count: number;
  isOnline: boolean;
  onFavorite: () => void;
  onHide: () => void;
  onTrash: () => void;
  onAddToAlbum: () => void;
  /** Only present in an album-detail context (remove selected from THIS album). */
  onRemoveFromAlbum?: () => void;
  /** Save the selection to the phone's gallery; left out when none of it is a server-only photo. */
  onDownload?: () => void;
  onShareLink?: () => void;
  /** Delete for good (asks first); only the Trash grid passes it. */
  onDeletePermanent?: () => void;
  /** Archive (or, on the Archive grid, unarchive) the selection. */
  onArchive?: () => void;
  /** Give every selected photo this many stars (0 clears). */
  onRate?: (rating: number) => void;
  /** Make the one selected photo the album's cover; album grids only. */
  onSetCover?: () => void;
  /** Screen-specific actions, appended to the "More" sheet. */
  extraActions?: SelectionExtraAction[];
  onCancel: () => void;
  /**
   * Which way each flag button goes: on Favorites the button unfavorites, on
   * Hidden it unhides, in Trash it restores, in Archive it unarchives. Defaults
   * to setting the flag.
   */
  directions?: { favorite: boolean; hidden: boolean; deleted: boolean; archived?: boolean };
};

const STARS = [1, 2, 3, 4, 5] as const;

export function SelectionActionBar(props: SelectionActionBarProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const disabled = props.count === 0;
  const dir = props.directions ?? { favorite: true, hidden: true, deleted: true };
  const archiveDirection = dir.archived ?? true;

  /** Close the sheet first, then act (the action usually ends selection mode). */
  const fromSheet = (run: () => void) => () => {
    setMoreOpen(false);
    run();
  };
  const onlineOnly = (action: GridAction) => {
    const available = isGridActionAvailable(action, props.isOnline);
    return { disabled: disabled || !available, hint: available ? undefined : t("offline.needsConnection") };
  };

  const more: SheetOption[] = [
    {
      key: "hide",
      testID: "action-hide",
      icon: dir.hidden ? "hide" : "unhide",
      label: dir.hidden ? t("selection.hide") : t("selection.unhide"),
      onPress: fromSheet(props.onHide),
      disabled,
    },
  ];
  if (props.onArchive) {
    more.push({
      key: "archive",
      testID: "action-archive",
      icon: "archive",
      label: archiveDirection ? t("selection.archive") : t("selection.unarchive"),
      onPress: fromSheet(props.onArchive),
      disabled,
    });
  }
  if (props.onSetCover && props.count === 1) {
    more.push({
      key: "set-cover",
      testID: "action-set-cover",
      icon: "photo",
      label: t("selection.setCover"),
      onPress: fromSheet(props.onSetCover),
    });
  }
  if (props.onDownload) {
    more.push({
      key: "download",
      testID: "action-download",
      icon: "download",
      label: t("selection.download"),
      onPress: fromSheet(props.onDownload),
      ...onlineOnly("download"),
    });
  }
  if (props.onDeletePermanent) {
    more.push({
      key: "delete-permanent",
      testID: "action-delete-permanent",
      icon: "deleteForever",
      label: t("selection.deletePermanent"),
      onPress: fromSheet(props.onDeletePermanent),
      destructive: true,
      ...onlineOnly("deletePermanent"),
    });
  }

  for (const extra of props.extraActions ?? []) {
    const available = !extra.onlineOnly || props.isOnline;
    more.push({
      key: extra.key,
      testID: `action-${extra.key}`,
      icon: extra.icon,
      label: extra.label,
      destructive: extra.destructive,
      onPress: fromSheet(extra.onPress),
      disabled: disabled || !available,
      hint: available ? undefined : t("offline.needsConnection"),
    });
  }

  const onRate = props.onRate;

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
        <BarButton testID="action-favorite" label={dir.favorite ? t("selection.favorite") : t("selection.unfavorite")} onPress={props.onFavorite} disabled={disabled} theme={theme} />
        <BarButton testID="action-add-album" label={t("selection.addToAlbum")} onPress={props.onAddToAlbum} disabled={disabled} theme={theme} />
        {props.onShareLink ? (
          <OnlineOnlyButton action="shareLink" testID="action-share-link" label={t("selection.share")} onPress={props.onShareLink} isOnline={props.isOnline} disabled={disabled} theme={theme} />
        ) : null}
        <BarButton testID="action-trash" label={dir.deleted ? t("selection.trash") : t("selection.restore")} onPress={props.onTrash} disabled={disabled} theme={theme} />
        {props.onRemoveFromAlbum ? (
          <BarButton testID="action-remove-album" label={t("mutations.remove")} onPress={props.onRemoveFromAlbum} disabled={disabled} theme={theme} />
        ) : null}
        <Pressable
          testID="action-more"
          accessibilityRole="button"
          accessibilityLabel={t("selection.more")}
          accessibilityState={{ disabled }}
          onPress={() => setMoreOpen(true)}
          disabled={disabled}
          style={[buttonStyle(theme, disabled), { flexDirection: "row", alignItems: "center", gap: 4 }]}
        >
          <Icon name="more" size={16} color={theme.text} />
          <Text style={{ color: theme.text, fontWeight: "600", fontSize: 13 }}>{t("selection.more")}</Text>
        </Pressable>
      </View>

      <OptionSheet
        visible={moreOpen}
        title={t("selection.moreTitle")}
        options={more}
        onClose={() => setMoreOpen(false)}
        testID="selection-more-sheet"
      >
        {onRate ? (
          <View style={{ paddingVertical: 10, borderBottomColor: theme.border, borderBottomWidth: 1, gap: 8 }}>
            <Text style={{ color: theme.text, fontSize: 15 }}>{t("selection.rating")}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {STARS.map((stars) => (
                <Pressable
                  key={stars}
                  testID={`action-rate-${stars}`}
                  accessibilityRole="button"
                  accessibilityLabel={t("selection.ratingStars", { count: stars })}
                  onPress={fromSheet(() => onRate(stars))}
                  hitSlop={6}
                  style={{ padding: 4 }}
                >
                  <Icon name="starOutline" size={26} color={theme.brand} />
                </Pressable>
              ))}
              <Pressable
                testID="action-rate-0"
                accessibilityRole="button"
                onPress={fromSheet(() => onRate(0))}
                hitSlop={6}
                style={{ marginLeft: "auto", padding: 4 }}
              >
                <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("selection.clearRating")}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </OptionSheet>
    </View>
  );
}

function buttonStyle(theme: ThemeColors, off: boolean) {
  return {
    opacity: off ? 0.4 : 1,
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  };
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
      style={buttonStyle(theme, !!disabled)}
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
  onPress: () => void;
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
      style={buttonStyle(theme, off)}
    >
      <Text style={{ color: available ? theme.text : theme.muted, fontWeight: "600", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}
