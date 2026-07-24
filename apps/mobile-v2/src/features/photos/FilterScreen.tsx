import { useCallback } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MirrorGrid, type GridItem } from "@/components/MirrorGrid";
import { useReactiveQuery } from "@/db/provider";
import { filterPhotos, type PhotoFilter, type PhotoTileRow } from "@/db/queries/filters";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { useTheme } from "@/theme";

export function tileRowToItem(r: PhotoTileRow): GridItem {
  return {
    key: r.id,
    photoId: r.id,
    imageHash: r.image_hash,
    type: r.type,
    dominantColor: r.dominant_color,
    localUri: null,
  };
}

/**
 * A flag-filter photo screen (favorites / hidden / deleted / videos / recent /
 * notimestamp), rendered from SQLite via a live query.
 */
export function FilterScreen({ filter, title }: { filter: PhotoFilter; title: string }) {
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();
  const items = useReactiveQuery((db) => filterPhotos(db, filter).map(tileRowToItem), [filter]);

  const openPhoto = useCallback(
    (item: GridItem) => {
      if (item.imageHash) router.push(`/photo/${item.imageHash}`);
    },
    [router]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text testID="filter-title" style={{ fontSize: 24, fontWeight: "700", color: theme.text }}>
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
            <View testID="filter-empty" style={{ padding: 32, alignItems: "center" }}>
              <Text style={{ color: theme.muted }}>Nothing here yet.</Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}
