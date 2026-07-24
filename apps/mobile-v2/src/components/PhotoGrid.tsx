import { useMemo } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import {
  imageHashOf,
  mediaHeaders,
  squareThumbnailUrl,
  type PigPhoto,
} from "@librephotos/api-client";

const NUM_COLUMNS = 3;
const GAP = 2;

type PhotoGridProps = {
  photos: PigPhoto[];
  serverAddress: string;
  accessToken: string | null;
  onPressPhoto?: (photo: PigPhoto) => void;
  ListEmptyComponent?: React.ComponentType | React.ReactElement | null;
  testID?: string;
};

/**
 * The timeline photo grid. Thumbnails are fetched from the LibrePhotos media
 * endpoint with an Authorization header (mobile has no shared cookie jar), and
 * expo-image disk-caches them. FlashList keeps 100k-item timelines smooth.
 */
export function PhotoGrid({
  photos,
  serverAddress,
  accessToken,
  onPressPhoto,
  ListEmptyComponent,
  testID = "photo-grid",
}: PhotoGridProps) {
  const { width } = useWindowDimensions();
  const size = useMemo(() => Math.floor((width - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS), [width]);
  const headers = useMemo(() => mediaHeaders(accessToken), [accessToken]);

  return (
    <FlashList
      testID={testID}
      data={photos}
      numColumns={NUM_COLUMNS}
      keyExtractor={(item) => item.id ?? imageHashOf(item)}
      ListEmptyComponent={ListEmptyComponent}
      renderItem={({ item }) => {
        const hash = imageHashOf(item);
        return (
          <Pressable
            testID={`photo-${hash}`}
            onPress={() => onPressPhoto?.(item)}
            style={{ width: size, height: size, margin: GAP / 2 }}
          >
            <Image
              testID={`thumb-${hash}`}
              style={{ width: "100%", height: "100%", backgroundColor: item.dominantColor ?? "#e5e7eb" }}
              source={{ uri: squareThumbnailUrl(serverAddress, hash), headers }}
              contentFit="cover"
              cachePolicy="disk"
              transition={120}
            />
            {item.type === "video" ? (
              <View
                testID={`video-badge-${hash}`}
                style={{ position: "absolute", right: 4, bottom: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" }}
              />
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}
