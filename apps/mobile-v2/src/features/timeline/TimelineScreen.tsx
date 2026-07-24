import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { TimelineList } from "@/components/TimelineList";
import type { GridItem } from "@/components/PhotoTile";
import { useMirrorTimeline } from "./useMirrorTimeline";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress, apiClient } from "@/lib/apiClient";
import { useDb } from "@/db/provider";
import { useAuthStore } from "@/stores/auth";
import { runSeed } from "@/sync/coordinator";
import { useTheme } from "@/theme";

/**
 * The photos timeline, rendered from SQLite via a live query (day section
 * headers + 3-column grid). Pull-to-refresh triggers a full re-seed (delta sync
 * lands in Phase 2). Tapping a photo opens the full-screen viewer by hash.
 */
export function TimelineScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDb();
  const token = useAccessToken();
  const base = serverAddress();
  const userId = useAuthStore((s) => s.userId);
  const { items, loadMore } = useMirrorTimeline();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    if (userId == null) return;
    setRefreshing(true);
    try {
      await runSeed(db, apiClient, { userId, force: false });
    } finally {
      setRefreshing(false);
    }
  }, [db, userId]);

  const openPhoto = useCallback(
    (item: GridItem) => {
      if (item.imageHash) router.push(`/photo/${item.imageHash}`);
    },
    [router]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text testID="timeline-title" style={{ fontSize: 24, fontWeight: "700", color: theme.text }}>
          {t("timeline.title")}
        </Text>
      </View>

      {items.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
        >
          <Text testID="timeline-empty" style={{ color: theme.muted }}>
            {t("timeline.empty")}
          </Text>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <TimelineList
            items={items}
            serverAddress={base}
            accessToken={token}
            onPressItem={openPhoto}
            onEndReached={loadMore}
          />
        </View>
      )}
    </SafeAreaView>
  );
}
