import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { bigThumbnailUrl, mediaHeaders } from "@librephotos/api-client";
import { useReactiveQuery } from "@/db/provider";
import { timelinePage } from "@/db/queries/timeline";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { usePhotoDetail } from "./usePhotoDetail";
import { useTheme } from "@/theme";

type Slide = { hash: string; key: string };

/**
 * Full-screen viewer. Pages horizontally over the current timeline context
 * (from the mirror), opening at the tapped photo's hash. Tapping toggles a
 * detail sheet whose EXIF/location come from the photo-detail endpoint,
 * cache-then-network (remote_photo_detail).
 */
export function PhotoViewerScreen() {
  const { id: imageHash } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const token = useAccessToken();
  const base = serverAddress();
  const { width, height } = useWindowDimensions();
  const headers = useMemo(() => mediaHeaders(token), [token]);
  const [showDetail, setShowDetail] = useState(false);

  // Pager context: a window of the timeline (mirror). Fallback to the single
  // tapped hash when it is not part of the visible timeline (e.g. hidden).
  const context = useReactiveQuery(
    (db) =>
      timelinePage(db, { limit: 500 }).rows
        .map((r) => r.image_hash)
        .filter((h): h is string => h != null),
    []
  );
  const slides: Slide[] = useMemo(() => {
    const hashes = context.includes(imageHash ?? "") ? context : imageHash ? [imageHash] : [];
    return hashes.map((h) => ({ hash: h, key: h }));
  }, [context, imageHash]);
  const initialIndex = Math.max(0, slides.findIndex((s) => s.hash === imageHash));

  const detail = usePhotoDetail(imageHash);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <FlashList
        testID="viewer-pager"
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        keyExtractor={(s) => s.key}
        renderItem={({ item }) => (
          <Pressable onPress={() => setShowDetail((v) => !v)} style={{ width, height, alignItems: "center", justifyContent: "center" }}>
            <Image
              testID={`viewer-image-${item.hash}`}
              style={{ width, height: height * 0.8 }}
              source={{ uri: bigThumbnailUrl(base, item.hash), headers }}
              contentFit="contain"
              cachePolicy="disk"
              transition={150}
            />
          </Pressable>
        )}
      />

      {showDetail ? (
        <View
          testID="viewer-detail-sheet"
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: theme.card, padding: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: height * 0.5 }}
        >
          {detail.isLoading ? (
            <Text style={{ color: theme.muted }}>Loading details…</Text>
          ) : detail.detail ? (
            <ScrollView>
              <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16, marginBottom: 8 }}>Details</Text>
              <DetailRow label="Camera" value={detail.detail.camera} theme={theme} />
              <DetailRow label="Date" value={detail.detail.exif_timestamp} theme={theme} />
              <DetailRow label="Location" value={detail.detail.search_location} theme={theme} />
              <DetailRow label="Rating" value={String(detail.detail.rating)} theme={theme} />
              {detail.fromCache ? (
                <Text testID="viewer-from-cache" style={{ color: theme.muted, fontSize: 11, marginTop: 8 }}>
                  Showing cached details
                </Text>
              ) : null}
            </ScrollView>
          ) : (
            <Text style={{ color: theme.muted }}>Details unavailable offline.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function DetailRow({ label, value, theme }: { label: string; value: string | null; theme: { text: string; muted: string } }) {
  return (
    <View style={{ flexDirection: "row", paddingVertical: 4 }}>
      <Text style={{ color: theme.muted, width: 90 }}>{label}</Text>
      <Text style={{ color: theme.text, flex: 1 }}>{value ?? "—"}</Text>
    </View>
  );
}
