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
import { useTheme } from "@/theme";

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
      // id, an image hash, or a local asset id.
      router.push(`/photo/${item.imageHash ?? item.key}`);
    },
    [router]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
        <Pressable testID="memories-back" onPress={() => goBackOr(router, "/photos")} hitSlop={8}>
          <Text style={{ color: theme.brand, fontSize: 16 }}>‹</Text>
        </Pressable>
        <Text style={{ fontSize: 22, fontWeight: "700", color: theme.text }}>{t("memories.title")}</Text>
      </View>
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
