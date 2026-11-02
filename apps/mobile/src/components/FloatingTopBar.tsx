import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AccountButton } from "@/features/account/AccountButton";
import { Icon, type IconName } from "@/components/Icon";
import { useTheme } from "@/theme";

/** Height of the floating button row, below the status bar. */
const BAR_HEIGHT = 52;

/**
 * Space a main screen leaves at the top of its scroll content so the first row
 * starts below the floating buttons; content then scrolls underneath them.
 */
export function useTopBarInset(): number {
  return useSafeAreaInsets().top + BAR_HEIGHT;
}

/**
 * The main screens have no title bar (it only takes space from the photos).
 * Instead a few round buttons and the account avatar float in the top-right
 * corner, over a thin scrim that keeps the status bar readable.
 */
export function FloatingTopBar({ children, left }: { children?: ReactNode; left?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
      <View pointerEvents="none" style={{ height: insets.top, backgroundColor: theme.background, opacity: 0.92 }} />
      <View
        pointerEvents="box-none"
        style={{ height: BAR_HEIGHT, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 }}
      >
        <View pointerEvents="box-none" style={{ flex: 1 }}>
          {left}
        </View>
        {children}
        <View style={{ borderRadius: 24, backgroundColor: theme.background, padding: 2 }}>
          <AccountButton />
        </View>
      </View>
    </View>
  );
}

/** A round icon button for the floating top bar. */
export function TopBarButton({
  icon,
  label,
  onPress,
  active = false,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Highlighted, e.g. while a filter is applied. */
  active?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? theme.brand : theme.background,
        borderWidth: active ? 0 : 1,
        borderColor: theme.border,
      }}
    >
      <Icon name={icon} size={20} color={active ? "#fff" : theme.text} />
    </Pressable>
  );
}
