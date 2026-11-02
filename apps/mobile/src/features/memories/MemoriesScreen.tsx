import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { MirrorGrid, type GridItem } from "@/components/MirrorGrid";
import { useReactiveQuery } from "@/db/provider";
import { onThisDay } from "@/db/queries/memories";
import { tileRowToItem } from "@/features/photos/FilterScreen";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { goBackOr } from "@/lib/navigation";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useTheme } from "@/theme";
import { photoRoute } from "@/features/viewer/route";

/** Full "On this day" grid (the memories notification / See-all target). */
export function MemoriesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();
  const items = useReactiveQuery((db) => onThisDay(db, { limit: 500 }).map(tileRowToItem), []);

  const openPhoto = useCallback(
    (item: GridItem) => {
      // Never a dead tap: a camera-roll asset has no image hash until it is
      // hashed, and the old `if (item.imageHash)` guard silently swallowed the
      // press so the viewer looked unimplemented. The viewer resolves a remote
      // id, an image hash, or a local asset id — and the tile it already has
      // rides along so the viewer can paint before it queries anything.
      router.push(photoRoute(item));
    },
    [router]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <ScreenHeader title={t("memories.title")} fallback="/photos" testID="memories" />
      <View style={{ flex: 1 }}>
        <MirrorGrid
          testID="memories-grid"
          items={items}
          serverAddress={base}
          accessToken={token}
          onPressItem={openPhoto}
          ListEmptyComponent={
            <View testID="memories-empty" style={{ padding: 32, alignItems: "center" }}>
              <Text style={{ color: theme.muted }}>{t("memories.empty")}</Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}
