import { useCallback } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MirrorGrid, type GridItem } from "@/components/MirrorGrid";
import { useReactiveQuery } from "@/db/provider";
import type { AppDatabase } from "@/db/types";
import type { PhotoTileRow } from "@/db/queries/filters";
import { tileRowToItem } from "@/features/photos/FilterScreen";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { useTheme } from "@/theme";

/** One album's photos (user or auto), rendered from mirrored membership. */
export function AlbumDetailScreen({
  title,
  query,
}: {
  title: string;
  query: (db: AppDatabase) => PhotoTileRow[];
}) {
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();
  const items = useReactiveQuery((db) => query(db).map(tileRowToItem), []);

  const openPhoto = useCallback(
    (item: GridItem) => {
      if (item.imageHash) router.push(`/photo/${item.imageHash}`);
    },
    [router]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text testID="album-detail-title" numberOfLines={1} style={{ fontSize: 22, fontWeight: "700", color: theme.text }}>
          {title}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <MirrorGrid
          items={items}
          serverAddress={base}
          accessToken={token}
          onPressItem={openPhoto}
          ListEmptyComponent={
            <View testID="album-empty" style={{ padding: 32, alignItems: "center" }}>
              <Text style={{ color: theme.muted }}>No photos in this album.</Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}
