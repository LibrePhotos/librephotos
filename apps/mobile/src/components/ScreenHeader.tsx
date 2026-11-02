import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "@/components/Icon";
import { goBackOr } from "@/lib/navigation";
import { useTheme } from "@/theme";

/**
 * The compact header of a pushed screen: a back (or close) button, the title,
 * and optional actions on the right. Main tab screens have no header at all.
 */
export function ScreenHeader({
  title,
  fallback,
  right,
  closeIcon = false,
  testID,
}: {
  title: string;
  /** Where "back" goes when there is no history (a deep link, a reload). */
  fallback: Href;
  right?: ReactNode;
  /** A ✕ instead of ‹, for a screen presented as a sheet. */
  closeIcon?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const icon: IconName = closeIcon ? "close" : "back";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8, gap: 4, minHeight: 52 }}>
      <Pressable
        testID={testID ? `${testID}-back` : "screen-back"}
        accessibilityRole="button"
        accessibilityLabel={closeIcon ? t("common.close") : t("common.back")}
        onPress={() => goBackOr(router, fallback)}
        hitSlop={8}
        style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name={icon} size={24} color={theme.text} />
      </Pressable>
      <Text testID={testID} numberOfLines={1} style={{ flex: 1, fontSize: 20, fontWeight: "700", color: theme.text }}>
        {title}
      </Text>
      {right}
    </View>
  );
}
