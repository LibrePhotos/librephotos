import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "@/components/Icon";
import { isViewerActionAvailable, type ViewerAction } from "@/features/mutations/offline";

/**
 * The full-screen viewer's bottom action bar: favorite, hide, trash/restore, a
 * 0–5 star rating row, and make-public.
 *
 * Everything here except make-public goes through the outbox, so it works
 * offline (doc 07 §4). Make-public has no mirror representation, so it renders
 * disabled with the standard "needs a connection" label rather than as a control
 * that silently does nothing.
 *
 * Presentational — the screen owns the mirror row and the mutation wiring.
 *
 * Like `ViewerChrome`, this sits on a scrim over an arbitrary photo and so uses
 * fixed on-scrim colours rather than theme text colours.
 */

const ON_SCRIM = "#ffffff";
const STAR_ON = "#fbbf24";
const STAR_OFF = "rgba(255,255,255,0.5)";

export type ViewerActionBarProps = {
  isFavorite: boolean;
  hidden: boolean;
  inTrashcan: boolean;
  isPublic: boolean;
  rating: number;
  isOnline: boolean;
  bottomInset: number;
  onToggleFavorite: () => void;
  onToggleHide: () => void;
  onToggleTrash: () => void;
  onTogglePublic: () => void;
  onRate: (rating: number) => void;
};

export function ViewerActionBar(props: ViewerActionBarProps) {
  const { t } = useTranslation();

  return (
    <View
      testID="viewer-action-bar"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingTop: 6,
        paddingBottom: props.bottomInset + 6,
        paddingHorizontal: 8,
        gap: 2,
        backgroundColor: "rgba(0,0,0,0.45)",
      }}
    >
      {/* 0–5 stars. The web exposes favouriting only through the server's
          `favorite_min_rating`; an explicit row is the honest mobile shape. */}
      <View
        testID="viewer-rating"
        accessibilityLabel={t("mutations.rate")}
        style={{ flexDirection: "row", justifyContent: "center", gap: 2 }}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            testID={`viewer-star-${n}`}
            accessibilityRole="button"
            accessibilityLabel={`${t("mutations.rate")} ${n}`}
            accessibilityState={{ selected: n <= props.rating }}
            onPress={() => props.onRate(n === props.rating ? 0 : n)}
            style={{ width: 44, height: 40, alignItems: "center", justifyContent: "center" }}
          >
            <Icon
              name={n <= props.rating ? "star" : "starOutline"}
              size={22}
              color={n <= props.rating ? STAR_ON : STAR_OFF}
            />
          </Pressable>
        ))}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-around", alignItems: "flex-start" }}>
        <BarAction
          testID="viewer-favorite"
          icon={props.isFavorite ? "star" : "starOutline"}
          label={props.isFavorite ? t("selection.unfavorite") : t("selection.favorite")}
          active={props.isFavorite}
          onPress={props.onToggleFavorite}
        />
        <BarAction
          testID="viewer-hide"
          icon={props.hidden ? "unhide" : "hide"}
          label={props.hidden ? t("selection.unhide") : t("selection.hide")}
          active={props.hidden}
          onPress={props.onToggleHide}
        />
        <BarAction
          testID="viewer-trash"
          icon={props.inTrashcan ? "restore" : "trash"}
          label={props.inTrashcan ? t("selection.restore") : t("selection.trash")}
          active={props.inTrashcan}
          onPress={props.onToggleTrash}
        />
        <BarAction
          testID="viewer-public"
          icon="public"
          label={props.isPublic ? t("viewer.makePrivate") : t("viewer.makePublic")}
          active={props.isPublic}
          action="makePublic"
          isOnline={props.isOnline}
          onPress={props.onTogglePublic}
        />
      </View>
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
      accessibilityState={{ disabled: !available, selected: !!active }}
      style={{
        minWidth: 64,
        minHeight: 48,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        opacity: available ? 1 : 0.4,
      }}
    >
      <Icon name={icon} size={22} color={active ? STAR_ON : ON_SCRIM} />
      <Text numberOfLines={1} style={{ color: ON_SCRIM, fontSize: 10, fontWeight: "600" }}>
        {available ? label : t("offline.needsConnection")}
      </Text>
    </Pressable>
  );
}
