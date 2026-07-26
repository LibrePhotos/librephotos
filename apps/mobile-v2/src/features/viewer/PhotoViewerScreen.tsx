import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { bigThumbnailUrl, mediaHeaders } from "@librephotos/api-client";
import { useDb, useReactiveQuery } from "@/db/provider";
import { timelinePage } from "@/db/queries/timeline";
import {
  photoFlagsByHash,
  remotePhotoIdByHash,
  viewerSlideById,
  type PhotoFlags,
  type ViewerSlide,
} from "@/db/queries/detail";
import { useMutations } from "@/mutations/useMutations";
import { TextPromptModal } from "@/components/TextPromptModal";
import { AlbumPickerSheet } from "@/components/AlbumPickerSheet";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { formatFullDate } from "@/lib/format";
import { usePhotoDetail } from "./usePhotoDetail";
import { ViewerActionBar } from "./ViewerActionBar";
import { ZoomableImage } from "./ZoomableImage";
import { useTheme } from "@/theme";

/**
 * Full-screen viewer. Pages horizontally over the current timeline context
 * (from the mirror), opening at the tapped photo. Tapping toggles a detail
 * sheet whose EXIF/location come from the photo-detail endpoint,
 * cache-then-network (remote_photo_detail); pinch and double-tap zoom.
 *
 * The route param is *any* identity the grid can hand it: a remote photo id, an
 * image hash, or a local asset id. It used to be an image hash only, and
 * callers guarded with `if (item.imageHash)` — so tapping a camera-roll photo
 * that had not been hashed yet did literally nothing, which is why the lightbox
 * was reported as "not implemented". Local-only slides render from their
 * `ph://` / `content://` uri and simply hide the server-side affordances.
 */
export function PhotoViewerScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  // Frozen for the life of this screen instance: the viewer is opened at one
  // photo and pages from there, and re-keying the (500-row) pager query on a
  // param identity change would re-run it for nothing.
  const [id] = useState(routeId);
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const db = useDb();
  const token = useAccessToken();
  const base = serverAddress();
  const mutations = useMutations();
  const { width, height } = useWindowDimensions();
  const headers = useMemo(() => mediaHeaders(token), [token]);
  const [showDetail, setShowDetail] = useState(false);
  const [currentKey, setCurrentKey] = useState<string | undefined>(undefined);
  const [editingCaption, setEditingCaption] = useState(false);
  const [pickingAlbum, setPickingAlbum] = useState(false);

  // Pager context: a window of the timeline (mirror), remote and local rows
  // alike. Falls back to a single resolved slide when the tapped photo is not
  // in that window (hidden photo, memories deep link, notification tap).
  const slides = useReactiveQuery<ViewerSlide[]>(
    (d) => {
      const rows = timelinePage(d, { limit: 500 }).rows.map(
        (r): ViewerSlide => ({
          key: (r.remote_id ?? r.local_id ?? r.image_hash) as string,
          remote_id: r.remote_id,
          local_id: r.local_id,
          image_hash: r.image_hash,
          local_uri: r.local_uri,
          type: r.type,
        })
      );
      if (id && rows.some((r) => matchesId(r, id))) return rows;
      const single = viewerSlideById(d, id ?? "");
      return single ? [single] : rows;
    },
    [id]
  );

  const initialIndex = Math.max(
    0,
    slides.findIndex((s) => (id ? matchesId(s, id) : false))
  );
  const current = useMemo(
    () => slides.find((s) => s.key === currentKey) ?? slides[initialIndex],
    [slides, currentKey, initialIndex]
  );
  const hash = current?.image_hash ?? null;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { key?: string | number | null }[] }) => {
      const first = viewableItems[0]?.key;
      if (typeof first === "string") setCurrentKey(first);
    }
  ).current;

  // Server-side flags exist only for photos the server knows about; a local-only
  // asset simply has no action bar rather than a bar that silently no-ops.
  const flags = useReactiveQuery<PhotoFlags | null>(
    (d) => (hash ? photoFlagsByHash(d, hash) : null),
    [hash]
  );

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

  const detail = usePhotoDetail(flags ? (hash ?? undefined) : undefined);
  const toggleSheet = useCallback(() => setShowDetail((v) => !v), []);

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
          <ZoomableImage
            testID={`viewer-image-${item.image_hash ?? item.key}`}
            width={width}
            height={height}
            onTap={toggleSheet}
            source={sourceFor(item, base, headers)}
          />
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
          {/* A local-only photo has no server record to describe — say so
              rather than spinning on a request that will never resolve. */}
          {!flags ? (
            <View>
              <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16, marginBottom: 8 }}>
                {t("viewer.details")}
              </Text>
              <Text testID="viewer-local-only" style={{ color: theme.muted }}>
                {t("viewer.localOnly")}
              </Text>
            </View>
          ) : detail.isLoading ? (
            <Text style={{ color: theme.muted }}>{t("viewer.loadingDetails")}</Text>
          ) : detail.detail ? (
            <ScrollView>
              <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16, marginBottom: 8 }}>
                {t("viewer.details")}
              </Text>
              <DetailRow label={t("viewer.camera")} value={detail.detail.camera} theme={theme} />
              <DetailRow
                label={t("viewer.date")}
                value={formatFullDate(detail.detail.exif_timestamp, { locale: i18n.language }) || null}
                theme={theme}
              />
              <DetailRow label={t("viewer.location")} value={detail.detail.search_location} theme={theme} />
              <DetailRow label={t("viewer.rating")} value={String(detail.detail.rating)} theme={theme} />
              {detail.fromCache ? (
                <Text testID="viewer-from-cache" style={{ color: theme.muted, fontSize: 11, marginTop: 8 }}>
                  {t("viewer.cachedDetails")}
                </Text>
              ) : null}
            </ScrollView>
          ) : (
            <Text style={{ color: theme.muted }}>{t("viewer.detailsOffline")}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

/** Does this slide answer to the given route param? */
function matchesId(slide: ViewerSlide, id: string): boolean {
  return (
    slide.key === id || slide.remote_id === id || slide.local_id === id || slide.image_hash === id
  );
}

/**
 * Local-first image source: the camera-roll file when we have it (instant, no
 * network, and the only option for a photo not yet uploaded), the server's big
 * thumbnail otherwise.
 */
function sourceFor(slide: ViewerSlide, base: string, headers: Record<string, string>) {
  if (slide.local_uri) return { uri: slide.local_uri };
  return slide.image_hash ? { uri: bigThumbnailUrl(base, slide.image_hash), headers } : { uri: "" };
}

function DetailRow({ label, value, theme }: { label: string; value: string | null; theme: { text: string; muted: string } }) {
  return (
    <View style={{ flexDirection: "row", paddingVertical: 4 }}>
      <Text style={{ color: theme.muted, width: 90 }}>{label}</Text>
      <Text style={{ color: theme.text, flex: 1 }}>{value ?? "—"}</Text>
    </View>
  );
}
