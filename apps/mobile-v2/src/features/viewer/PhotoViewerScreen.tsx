import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { bigThumbnailUrl, mediaHeaders } from "@librephotos/api-client";
import { useDb, useReactiveQuery } from "@/db/provider";
import { timelinePage } from "@/db/queries/timeline";
import { photoFlagsByHash, remotePhotoIdByHash, type PhotoFlags } from "@/db/queries/detail";
import { useMutations } from "@/mutations/useMutations";
import { TextPromptModal } from "@/components/TextPromptModal";
import { AlbumPickerSheet } from "@/components/AlbumPickerSheet";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { usePhotoDetail } from "./usePhotoDetail";
import { ViewerActionBar } from "./ViewerActionBar";
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
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDb();
  const token = useAccessToken();
  const base = serverAddress();
  const mutations = useMutations();
  const { width, height } = useWindowDimensions();
  const headers = useMemo(() => mediaHeaders(token), [token]);
  const [showDetail, setShowDetail] = useState(false);
  const [currentHash, setCurrentHash] = useState<string | undefined>(imageHash);
  const [editingCaption, setEditingCaption] = useState(false);
  const [pickingAlbum, setPickingAlbum] = useState(false);

  const flags = useReactiveQuery<PhotoFlags | null>(
    (d) => (currentHash ? photoFlagsByHash(d, currentHash) : null),
    [currentHash]
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { key?: string | number | null }[] }) => {
      const first = viewableItems[0]?.key;
      if (typeof first === "string") setCurrentHash(first);
    }
  ).current;

  const hash = currentHash;
  const toggleFavorite = useCallback(() => {
    if (hash && flags) mutations.favorite([hash], flags.is_favorite === 0);
  }, [hash, flags, mutations]);
  const toggleHide = useCallback(() => {
    if (hash && flags) mutations.hide([hash], flags.hidden === 0);
  }, [hash, flags, mutations]);
  const toggleTrash = useCallback(() => {
    if (hash && flags) mutations.trash([hash], flags.in_trashcan === 0);
  }, [hash, flags, mutations]);
  const rate = useCallback(
    (r: number) => {
      if (hash) mutations.rate(hash, r);
    },
    [hash, mutations]
  );

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
        onViewableItemsChanged={onViewableItemsChanged}
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

      {flags ? (
        <ViewerActionBar
          isFavorite={flags.is_favorite === 1}
          hidden={flags.hidden === 1}
          inTrashcan={flags.in_trashcan === 1}
          rating={flags.rating}
          onToggleFavorite={toggleFavorite}
          onToggleHide={toggleHide}
          onToggleTrash={toggleTrash}
          onRate={rate}
          onEditCaption={() => setEditingCaption(true)}
          onAddToAlbum={() => setPickingAlbum(true)}
        />
      ) : null}

      <TextPromptModal
        visible={editingCaption}
        title={t("mutations.caption")}
        placeholder={t("mutations.captionPlaceholder")}
        submitLabel={t("mutations.save")}
        multiline
        testID="viewer-caption-prompt"
        onSubmit={(value) => {
          setEditingCaption(false);
          if (hash) mutations.caption(hash, value);
        }}
        onCancel={() => setEditingCaption(false)}
      />

      <AlbumPickerSheet
        visible={pickingAlbum}
        onPick={(album) => {
          setPickingAlbum(false);
          if (hash) {
            const photoId = remotePhotoIdByHash(db, hash);
            if (photoId) mutations.addToAlbum(album.id, album.title, [photoId], [hash]);
          }
        }}
        onCreate={(title) => {
          setPickingAlbum(false);
          if (hash) {
            const photoId = remotePhotoIdByHash(db, hash);
            mutations.createAlbum(title, photoId ? [photoId] : []);
          }
        }}
        onCancel={() => setPickingAlbum(false)}
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
