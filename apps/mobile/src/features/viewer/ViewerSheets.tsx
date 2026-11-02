import { useEffect, type ReactNode } from "react";
import { BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "@/components/Icon";
import { isViewerActionAvailable, type ViewerAction } from "@/features/mutations/offline";
import { useTheme } from "@/theme";

/**
 * The viewer's secondary surfaces: the "⋯" sheet (everything that is not one
 * of the five bar actions) and the Edit sheet (rotate, date, location, tags).
 *
 * Google Photos keeps its bar to a handful of actions and puts the rest one tap
 * away in a list; these are that list. Online-only rows render disabled with the
 * standard "needs a connection" note, never as rows that silently do nothing.
 */

const DESTRUCTIVE = "#dc2626";
const STAR_ON = "#fbbf24";

type SheetProps = {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  testID: string;
};

/** The sheet's card: a title row with a close button over `children`. */
function SheetCard({ title, onClose, children, testID }: Omit<SheetProps, "visible">) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      testID={testID}
      // Swallow taps on the card, so only the backdrop closes the sheet.
      onPress={() => {}}
      style={{
        backgroundColor: theme.card,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingTop: 12,
        paddingHorizontal: 16,
        paddingBottom: insets.bottom + 12,
        maxHeight: "85%",
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16 }}>{title}</Text>
        <Pressable
          testID={`${testID}-close`}
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        >
          <Icon name="close" size={22} color={theme.muted} />
        </Pressable>
      </View>
      {children}
    </Pressable>
  );
}

const BACKDROP = { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" } as const;

/**
 * A bottom-anchored card in a native `Modal`, for the editors (date, place,
 * tags). Tapping the backdrop closes it.
 */
export function ModalSheet({ visible, onClose, ...card }: SheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable testID={`${card.testID}-backdrop`} onPress={onClose} style={BACKDROP}>
        <SheetCard onClose={onClose} {...card} />
      </Pressable>
    </Modal>
  );
}

/**
 * The same card drawn over the viewer instead of in a native `Modal`, for the
 * menus. Most menu rows open an editor, and iOS presents one modal at a time:
 * an editor opened while a menu modal is still animating away is never shown.
 */
export function OverlaySheet({ visible, onClose, ...card }: SheetProps) {
  useEffect(() => {
    if (!visible) return;
    // Android's back button closes the menu, as it would a modal.
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);
  if (!visible) return null;
  return (
    <Pressable testID={`${card.testID}-backdrop`} onPress={onClose} style={[StyleSheet.absoluteFill, BACKDROP]}>
      <SheetCard onClose={onClose} {...card} />
    </Pressable>
  );
}

export type MenuItem = {
  key: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  /** When given, availability follows the offline policy (online-only rows disable offline). */
  action?: ViewerAction;
  destructive?: boolean;
};

/** A list of menu rows inside an `OverlaySheet`. A row closes the sheet, then runs. */
export function MenuSheet({
  visible,
  title,
  items,
  isOnline,
  onClose,
  header,
  testID,
}: {
  visible: boolean;
  title: string;
  items: MenuItem[];
  isOnline: boolean;
  onClose: () => void;
  header?: ReactNode;
  testID: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <OverlaySheet visible={visible} title={title} onClose={onClose} testID={testID}>
      <ScrollView>
        {header}
        {items.map((item) => {
          const available = item.action ? isViewerActionAvailable(item.action, isOnline) : true;
          const color = item.destructive ? DESTRUCTIVE : theme.text;
          return (
            <Pressable
              key={item.key}
              testID={`viewer-menu-${item.key}`}
              disabled={!available}
              onPress={
                available
                  ? () => {
                      onClose();
                      item.onPress();
                    }
                  : undefined
              }
              accessibilityRole="button"
              accessibilityState={{ disabled: !available }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 14,
                minHeight: 48,
                opacity: available ? 1 : 0.45,
              }}
            >
              <Icon name={item.icon} size={22} color={color} />
              <View style={{ flex: 1 }}>
                <Text style={{ color, fontSize: 15 }}>{item.label}</Text>
                {available ? null : (
                  <Text style={{ color: theme.muted, fontSize: 12 }}>{t("offline.needsConnection")}</Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </OverlaySheet>
  );
}

/** 0–5 stars; tapping the current rating clears it. Offline-capable (outbox `rating`). */
export function RatingRow({ rating, onRate }: { rating: number; onRate: (rating: number) => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 4 }}>
      <Text style={{ color: theme.text, fontSize: 15, flex: 1 }}>{t("viewer.rating")}</Text>
      <View testID="viewer-rating" accessibilityLabel={t("mutations.rate")} style={{ flexDirection: "row" }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            testID={`viewer-star-${n}`}
            accessibilityRole="button"
            accessibilityLabel={`${t("mutations.rate")} ${n}`}
            accessibilityState={{ selected: n <= rating }}
            onPress={() => onRate(n === rating ? 0 : n)}
            style={{ width: 40, height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name={n <= rating ? "star" : "starOutline"} size={24} color={n <= rating ? STAR_ON : theme.muted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export type ViewerMoreSheetProps = {
  visible: boolean;
  onClose: () => void;
  isOnline: boolean;
  rating: number;
  hidden: boolean;
  archived: boolean;
  isPublic: boolean;
  inTrashcan: boolean;
  /** A server-only item: saving it fetches the original. A phone copy is on the device already. */
  canSaveToDevice: boolean;
  onRate: (rating: number) => void;
  onSaveToDevice: () => void;
  onAddToAlbum: () => void;
  onToggleArchive: () => void;
  onToggleHide: () => void;
  onTogglePublic: () => void;
  onDeletePermanently: () => void;
};

/** Everything after the bar's five actions. */
export function ViewerMoreSheet(props: ViewerMoreSheetProps) {
  const { t } = useTranslation();
  const items: MenuItem[] = [];
  if (props.canSaveToDevice) {
    items.push({
      key: "save",
      icon: "download",
      label: t("viewer.saveToDevice"),
      action: "saveToDevice",
      onPress: props.onSaveToDevice,
    });
  }
  items.push(
    { key: "album", icon: "album", label: t("selection.addToAlbum"), action: "addToAlbum", onPress: props.onAddToAlbum },
    {
      key: "archive",
      icon: "archive",
      label: props.archived ? t("viewer.unarchive") : t("viewer.archive"),
      action: "archive",
      onPress: props.onToggleArchive,
    },
    {
      key: "hide",
      icon: props.hidden ? "unhide" : "hide",
      label: props.hidden ? t("selection.unhide") : t("selection.hide"),
      action: "hide",
      onPress: props.onToggleHide,
    },
    {
      key: "public",
      icon: "public",
      label: props.isPublic ? t("viewer.makePrivate") : t("viewer.makePublic"),
      action: "makePublic",
      onPress: props.onTogglePublic,
    }
  );
  // Only a trashed item can be deleted for good, as on the web's Trash.
  if (props.inTrashcan) {
    items.push({
      key: "delete-permanent",
      icon: "deleteForever",
      label: t("selection.deletePermanent"),
      action: "deletePermanent",
      destructive: true,
      onPress: props.onDeletePermanently,
    });
  }
  return (
    <MenuSheet
      testID="viewer-more-sheet"
      visible={props.visible}
      title={t("viewer.more")}
      items={items}
      isOnline={props.isOnline}
      onClose={props.onClose}
      header={<RatingRow rating={props.rating} onRate={props.onRate} />}
    />
  );
}

export type ViewerEditSheetProps = {
  visible: boolean;
  onClose: () => void;
  isOnline: boolean;
  /** Videos are not rotated server-side. */
  canRotate: boolean;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onEditDate: () => void;
  onEditLocation: () => void;
  onEditTags: () => void;
};

/** The photo's editable facts. All server-side edits, so all online-only. */
export function ViewerEditSheet(props: ViewerEditSheetProps) {
  const { t } = useTranslation();
  const items: MenuItem[] = [];
  if (props.canRotate) {
    items.push(
      { key: "rotate-left", icon: "rotateLeft", label: t("viewer.rotateLeft"), action: "rotate", onPress: props.onRotateLeft },
      {
        key: "rotate-right",
        icon: "rotateRight",
        label: t("viewer.rotateRight"),
        action: "rotate",
        onPress: props.onRotateRight,
      }
    );
  }
  items.push(
    { key: "date", icon: "calendar", label: t("viewer.editDateTime"), action: "timestamp", onPress: props.onEditDate },
    { key: "location", icon: "location", label: t("viewer.editLocation"), action: "location", onPress: props.onEditLocation },
    { key: "tags", icon: "tags", label: t("viewer.editTags"), action: "tags", onPress: props.onEditTags }
  );
  return (
    <MenuSheet
      testID="viewer-edit-sheet"
      visible={props.visible}
      title={t("viewer.edit")}
      items={items}
      isOnline={props.isOnline}
      onClose={props.onClose}
    />
  );
}
