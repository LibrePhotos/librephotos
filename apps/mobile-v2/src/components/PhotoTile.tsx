import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { squareThumbnailUrl } from "@librephotos/api-client";
import { useDb } from "@/db/provider";
import { getThumb } from "@/sync/thumbs";

/** Normalized grid item — the shape every mirror query maps onto for display. */
export type GridItem = {
  key: string;
  photoId: string | null;
  imageHash: string | null;
  type: string | null;
  dominantColor: string | null;
  localUri: string | null;
};

/**
 * One photo thumbnail. Resolves local-first: a camera-roll asset renders from
 * its `ph://`/`content://` uri, a prefetched remote thumb from its cached file
 * (thumb_cache), otherwise the network media endpoint (expo-image disk-caches).
 */
export function PhotoTile({
  item,
  size,
  serverAddress,
  headers,
  onPress,
  onLongPress,
  selectionActive = false,
  selected = false,
}: {
  item: GridItem;
  size: number;
  serverAddress: string;
  headers: Record<string, string>;
  onPress?: (item: GridItem) => void;
  onLongPress?: (item: GridItem) => void;
  selectionActive?: boolean;
  selected?: boolean;
}) {
  const db = useDb();
  const uri = resolveUri(db, item, serverAddress);
  return (
    <Pressable
      testID={`tile-${item.key}`}
      onPress={() => onPress?.(item)}
      onLongPress={() => onLongPress?.(item)}
      delayLongPress={250}
      style={{ width: size, height: size, opacity: selectionActive && !selected ? 0.6 : 1 }}
    >
      <Image
        testID={`thumb-${item.key}`}
        style={{ width: "100%", height: "100%", backgroundColor: item.dominantColor ?? "#e5e7eb" }}
        source={uri ? { uri, headers } : undefined}
        contentFit="cover"
        cachePolicy="disk"
        transition={120}
      />
      {item.type === "video" ? (
        <View
          testID={`video-badge-${item.key}`}
          style={{ position: "absolute", right: 4, bottom: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" }}
        />
      ) : null}
      {/* Local-only asset (no remote counterpart yet): pending-upload badge.
          Flips off once the uploaded/exists-matched server row arrives on the
          next delta sync and the merged-timeline join absorbs this row. */}
      {item.photoId === null ? (
        <View
          testID={`local-badge-${item.key}`}
          style={{
            position: "absolute",
            left: 3,
            bottom: 3,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: "#22c55e",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 9, fontWeight: "900", lineHeight: 11 }}>↑</Text>
        </View>
      ) : null}
      {selectionActive ? (
        <View
          testID={`select-mark-${item.key}`}
          style={{
            position: "absolute",
            right: 4,
            top: 4,
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: "#fff",
            backgroundColor: selected ? "#208AEF" : "rgba(0,0,0,0.25)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {selected ? <Text style={{ color: "#fff", fontSize: 11, fontWeight: "900", lineHeight: 13 }}>✓</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function resolveUri(
  db: ReturnType<typeof useDb>,
  item: GridItem,
  serverAddress: string
): string | null {
  if (item.localUri) return item.localUri;
  if (item.photoId) {
    const cached = getThumb(db, item.photoId);
    if (cached) return cached.file_path;
  }
  return item.imageHash ? squareThumbnailUrl(serverAddress, item.imageHash) : null;
}
