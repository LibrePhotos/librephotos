import { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useRecentlyAddedPhotosQuery, type PigPhoto } from "@librephotos/api-client";
import { PhotoGrid } from "@/components/PhotoGrid";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { useTheme } from "@/theme";

/**
 * Online timeline proof. Fetches photos through the shared api-client query hook
 * (the same recently-added endpoint the web timeline uses) and renders them in a
 * FlashList grid with auth-headered expo-image thumbnails. This is the vertical
 * slice that proves auth + transport + schemas + image loading end-to-end,
 * ahead of the offline SQLite mirror in the next phase.
 */
export function TimelineScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const token = useAccessToken();
  const base = serverAddress();
  const query = useRecentlyAddedPhotosQuery();

  const photos = useMemo<PigPhoto[]>(() => query.data?.results ?? [], [query.data]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text testID="timeline-title" style={{ fontSize: 24, fontWeight: "700", color: theme.text }}>
          {t("timeline.title")}
        </Text>
      </View>

      {query.isLoading ? (
        <View testID="timeline-loading" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={theme.brand} />
        </View>
      ) : query.isError ? (
        <View testID="timeline-error" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: theme.muted }}>{t("timeline.error")}</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <PhotoGrid
            photos={photos}
            serverAddress={base}
            accessToken={token}
            ListEmptyComponent={
              <View testID="timeline-empty" style={{ padding: 32, alignItems: "center" }}>
                <Text style={{ color: theme.muted }}>{t("timeline.empty")}</Text>
              </View>
            }
          />
        </View>
      )}
    </SafeAreaView>
  );
}
