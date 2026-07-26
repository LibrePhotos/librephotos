import { useCallback } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MirrorGrid, type GridItem } from "@/components/MirrorGrid";
import { useReactiveQuery } from "@/db/provider";
import { filterPhotos, type PhotoFilter, type PhotoTileRow } from "@/db/queries/filters";
import { useGridSelection, type SelectionDirections } from "@/features/selection/useGridSelection";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { useTheme } from "@/theme";

/** On a flag screen the primary action inverts that flag (unfavorite/unhide/restore). */
function directionsFor(filter: PhotoFilter): SelectionDirections {
  switch (filter) {
    case "favorites":
      return { favorite: false };
    case "hidden":
      return { hidden: false };
    case "deleted":
      return { deleted: false };
    default:
      return {};
  }
}

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
  const selection = useGridSelection(directionsFor(filter));

  const openPhoto = useCallback(
    (item: GridItem) => {
      if (selection.active) {
        selection.toggle(item);
        return;
      }
      // Never a dead tap: a camera-roll asset has no image hash until it is
      // hashed, and the old `if (item.imageHash)` guard silently swallowed the
      // press so the viewer looked unimplemented. The viewer resolves a remote
      // id, an image hash, or a local asset id.
      router.push(`/photo/${item.imageHash ?? item.key}`);
    },
    [router, selection]
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
          onLongPressItem={selection.enter}
          selectionActive={selection.active}
          isSelected={selection.isSelected}
          ListEmptyComponent={
            <View testID="filter-empty" style={{ padding: 32, alignItems: "center" }}>
              <Text style={{ color: theme.muted }}>Nothing here yet.</Text>
            </View>
          }
        />
      </View>
      {selection.overlay}
    </SafeAreaView>
  );
}
