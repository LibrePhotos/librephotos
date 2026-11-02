import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "@/components/Icon";
import { isViewerActionAvailable, type ViewerAction } from "@/features/mutations/offline";

/**
 * The full-screen viewer's bottom action bar, phone-first like Google Photos:
 * the five most-used actions with labels — Share, Favorite, Edit,
 * Trash/Restore and "More" — and everything else one tap away in the "⋯" sheet
 * (`ViewerMoreSheet`) or the Edit sheet (`ViewerEditSheet`).
 *
 * Favorite and trash go through the outbox and work offline (doc 07 §4). Share
 * needs the original from the server unless the item has a copy on this phone;
 * a server-only item offline renders Share disabled with the standard "needs a
 * connection" label rather than as a control that silently does nothing.
 *
 * A camera-roll-only item (`mode: "local"`) has no server row, so it gets Share
 * alone: a bar full of no-ops is worse than a short one (doc 07 §1.4).
 *
 * Presentational — the screen owns the mirror row and the mutation wiring.
 * Like `ViewerChrome`, this sits on a scrim over an arbitrary photo and so uses
 * fixed on-scrim colours rather than theme text colours.
 */

const ON_SCRIM = "#ffffff";
const ACTIVE = "#fbbf24";

/** The bar's height above the bottom inset (room for a two-line offline label). */
export const ACTION_BAR_HEIGHT = 64;

export type ViewerActionBarProps =
  | {
      mode: "local";
      isOnline: boolean;
      bottomInset: number;
      onShare: () => void;
    }
  | {
      mode: "remote";
      isFavorite: boolean;
      inTrashcan: boolean;
      /** The item has a copy on this phone, so sharing it needs no network. */
      hasLocalCopy: boolean;
      isOnline: boolean;
      bottomInset: number;
      onShare: () => void;
      onToggleFavorite: () => void;
      onEdit: () => void;
      onToggleTrash: () => void;
      onMore: () => void;
    };

export function ViewerActionBar(props: ViewerActionBarProps) {
  const { t } = useTranslation();
  const shareGate: ViewerAction | undefined = props.mode === "local" || props.hasLocalCopy ? undefined : "share";

  return (
    <View
      testID={props.mode === "local" ? "viewer-local-action-bar" : "viewer-action-bar"}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: ACTION_BAR_HEIGHT + props.bottomInset,
        paddingBottom: props.bottomInset,
        paddingHorizontal: 4,
        flexDirection: "row",
        justifyContent: "space-around",
        alignItems: "center",
        backgroundColor: "rgba(0,0,0,0.45)",
      }}
    >
      <BarAction
        testID="viewer-share"
        icon="share"
        label={t("viewer.share")}
        action={shareGate}
        isOnline={props.isOnline}
        onPress={props.onShare}
      />
      {props.mode === "remote" ? (
        <>
          <BarAction
            testID="viewer-favorite"
            icon={props.isFavorite ? "star" : "starOutline"}
            label={props.isFavorite ? t("selection.unfavorite") : t("selection.favorite")}
            active={props.isFavorite}
            onPress={props.onToggleFavorite}
          />
          <BarAction testID="viewer-edit" icon="edit" label={t("viewer.edit")} onPress={props.onEdit} />
          <BarAction
            testID="viewer-trash"
            icon={props.inTrashcan ? "restore" : "trash"}
            label={props.inTrashcan ? t("selection.restore") : t("selection.trash")}
            onPress={props.onToggleTrash}
          />
          <BarAction testID="viewer-more" icon="more" label={t("viewer.more")} onPress={props.onMore} />
        </>
      ) : null}
    </View>
  );
}

function BarAction({
  icon,
  label,
  onPress,
  active,
  action,
  isOnline = true,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  /** When given, availability is decided by the offline policy. */
  action?: ViewerAction;
  isOnline?: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  const available = action ? isViewerActionAvailable(action, isOnline) : true;
  return (
    <Pressable
      testID={testID}
      onPress={available ? onPress : undefined}
      disabled={!available}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !available, selected: !!active }}
      style={{
        flex: 1,
        maxWidth: 88,
        minHeight: 52,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        opacity: available ? 1 : 0.5,
      }}
    >
      <Icon name={icon} size={22} color={active ? ACTIVE : ON_SCRIM} />
      <Text
        numberOfLines={2}
        style={{ color: ON_SCRIM, fontSize: 10, fontWeight: "600", textAlign: "center", lineHeight: 12 }}
      >
        {available ? label : t("offline.needsConnection")}
      </Text>
    </Pressable>
  );
}
