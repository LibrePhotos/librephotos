import { Pressable, View } from "react-native";
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
}: {
  item: GridItem;
  size: number;
  serverAddress: string;
  headers: Record<string, string>;
  onPress?: (item: GridItem) => void;
}) {
  const db = useDb();
  const uri = resolveUri(db, item, serverAddress);
  return (
    <Pressable
      testID={`tile-${item.key}`}
      onPress={() => onPress?.(item)}
      style={{ width: size, height: size }}
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
      {item.photoId === null ? (
        <View
          testID={`local-badge-${item.key}`}
          style={{ position: "absolute", left: 4, bottom: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: "#22c55e" }}
        />
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
