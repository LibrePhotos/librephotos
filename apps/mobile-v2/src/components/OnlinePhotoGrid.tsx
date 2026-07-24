import { ActivityIndicator, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { MirrorGrid, type GridItem } from "@/components/MirrorGrid";
import { useAccessToken } from "@/hooks/use-access-token";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { serverAddress } from "@/lib/apiClient";
import { useTheme } from "@/theme";

/**
 * A photo grid backed by an online (api-client) query. Renders clear
 * loading / error / offline / empty states around the shared MirrorGrid.
 * Tapping a tile opens the full-screen viewer by hash. Used by the
 * thing/place/tag album detail screens and search results (doc 05 §Albums,
 * membership is not mirrored so these grids are online-only).
 */
export function OnlinePhotoGrid({
  items,
  isLoading,
  isError,
  offlineMessage,
  emptyMessage,
  testID = "online-grid",
  ListHeaderComponent,
}: {
  items: GridItem[];
  isLoading: boolean;
  isError: boolean;
  offlineMessage?: string;
  emptyMessage?: string;
  testID?: string;
  ListHeaderComponent?: React.ComponentType | React.ReactElement | null;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();
  const isOnline = useOnlineStatus();

  const openPhoto = (item: GridItem) => {
    if (item.imageHash) router.push(`/photo/${item.imageHash}`);
  };

  if (!isOnline && items.length === 0) {
    return (
      <View testID={`${testID}-offline`} style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: theme.text, fontWeight: "600", marginBottom: 6 }}>{t("common.offline")}</Text>
        <Text style={{ color: theme.muted, textAlign: "center" }}>{offlineMessage ?? t("common.offlineHint")}</Text>
      </View>
    );
  }

  if (isLoading && items.length === 0) {
    return (
      <View testID={`${testID}-loading`} style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }

  if (isError && items.length === 0) {
    return (
      <View testID={`${testID}-error`} style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: theme.muted }}>{t("common.error")}</Text>
      </View>
    );
  }

  return (
    <MirrorGrid
      testID={testID}
      items={items}
      serverAddress={base}
      accessToken={token}
      onPressItem={openPhoto}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={
        <View testID={`${testID}-empty`} style={{ padding: 32, alignItems: "center" }}>
          <Text style={{ color: theme.muted }}>{emptyMessage ?? t("common.empty")}</Text>
        </View>
      }
    />
  );
}
