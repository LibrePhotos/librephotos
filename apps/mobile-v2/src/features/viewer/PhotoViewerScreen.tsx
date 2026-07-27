import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import {
  bigThumbnailUrl,
  endpoints,
  mediaHeaders,
  photoUrl,
  useApiClient,
  useSiteSettingsQuery,
  videoUrl,
  type People,
} from "@librephotos/api-client";
import { useDb, useReactiveQuery } from "@/db/provider";
import { timelinePage } from "@/db/queries/timeline";
import {
  albumsContainingPhoto,
  localAssetById,
  personIdByName,
  photoFlagsByHash,
  photoSummaryByHash,
  remotePhotoIdByHash,
  viewerSlideById,
  type PhotoAlbumRow,
  type PhotoFlags,
  type PhotoSummary,
  type ViewerSlide,
} from "@/db/queries/detail";
import { useMutations } from "@/mutations/useMutations";
import { TextPromptModal } from "@/components/TextPromptModal";
import { AlbumPickerSheet } from "@/components/AlbumPickerSheet";
import type { SheetDetent } from "@/components/BottomSheet";
import { useAccessToken } from "@/hooks/use-access-token";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { serverAddress } from "@/lib/apiClient";
import { goBackOr } from "@/lib/navigation";
import { formatFullDate } from "@/lib/format";
import { useToastStore } from "@/stores/toasts";
import { usePhotoDetail } from "./usePhotoDetail";
import { PhotoInfoSheet } from "./PhotoInfoSheet";
import { ViewerActionBar } from "./ViewerActionBar";
import { ThumbnailStrip, ViewerTopBar } from "./ViewerChrome";
import { ZoomableImage } from "./ZoomableImage";
import { VideoSlide } from "./VideoSlide";
import { FaceOverlay } from "./FaceOverlay";
import { parseEditableTimestamp, toEditableTimestamp } from "./timestamp";

/**
 * Full-screen viewer — the mobile answer to the web lightbox (see
 * `plans/mobile-v2/07-lightbox-parity.md`).
 *
 * Pages horizontally over the current timeline context (from the mirror),
 * opening at the tapped photo. Chrome (top bar, filmstrip, action bar) toggles
 * on a single tap; the info surface is a draggable bottom sheet, because a phone
 * has no room for the web's 400px sidebar.
 *
 * The route param is *any* identity the grid can hand it: a remote photo id, an
 * image hash, or a local asset id. It used to be an image hash only, and callers
 * guarded with `if (item.imageHash)` — so tapping a camera-roll photo that had
 * not been hashed yet did literally nothing, which is why the lightbox was
 * reported as "not implemented". Local-only slides render from their
 * `ph://` / `content://` uri and say, in the sheet, why the server-side sections
 * are empty rather than showing blanks.
 */
export function PhotoViewerScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  // Frozen for the life of this screen instance: the viewer is opened at one
  // photo and pages from there, and re-keying the (500-row) pager query on a
  // param identity change would re-run it for nothing.
  const [id] = useState(routeId);
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const db = useDb();
  const client = useApiClient();
  const token = useAccessToken();
  const base = serverAddress();
  const mutations = useMutations();
  const isOnline = useOnlineStatus();
  const insets = useSafeAreaInsets();
  const pushToast = useToastStore((s) => s.push);
  const { width, height } = useWindowDimensions();
  const headers = useMemo(() => mediaHeaders(token), [token]);

  const [chromeVisible, setChromeVisible] = useState(true);
  const [detent, setDetent] = useState<SheetDetent>("hidden");
  const [currentKey, setCurrentKey] = useState<string | undefined>(undefined);
  const [pickingAlbum, setPickingAlbum] = useState(false);
  const [editingTimestamp, setEditingTimestamp] = useState(false);
  const [renamingPerson, setRenamingPerson] = useState<People | null>(null);
  const [highlightedFace, setHighlightedFace] = useState<number | null>(null);

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
  const listRef = useRef<React.ComponentRef<typeof FlashList<ViewerSlide>>>(null);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { key?: string | number | null }[] }) => {
      const first = viewableItems[0]?.key;
      if (typeof first === "string") setCurrentKey(first);
    }
  ).current;

  // A new slide is a new subject: a face box from the previous photo would be
  // drawn over an unrelated one.
  useEffect(() => setHighlightedFace(null), [currentKey]);

  /* ---- data ------------------------------------------------------------ */

  // Server-side rows exist only for photos the server knows about; a local-only
  // asset gets its metadata from the camera roll instead.
  const flags = useReactiveQuery<PhotoFlags | null>(
    (d) => (hash ? photoFlagsByHash(d, hash) : null),
    [hash]
  );
  const summary = useReactiveQuery<PhotoSummary | null>(
    (d) => (hash ? photoSummaryByHash(d, hash) : null),
    [hash]
  );
  const local = useReactiveQuery(
    (d) => (current?.local_id ? localAssetById(d, current.local_id) : null),
    [current?.local_id]
  );
  const albums = useReactiveQuery<PhotoAlbumRow[]>(
    (d) => (summary ? albumsContainingPhoto(d, summary.id) : []),
    [summary?.id]
  );

  const detail = usePhotoDetail(flags ? (hash ?? undefined) : undefined);
  // Site settings decide whether the server wants maps shown at all — the same
  // `map_tile_provider === "none"` switch the web frontend honours.
  const settings = useSiteSettingsQuery();
  const mapsDisabled = settings.data?.map_tile_provider === "none";

  /* ---- neighbour preloading -------------------------------------------- */

  // The web lightbox preloads prev/main/next; mobile widens that to ±2 because
  // a swipe is faster and cheaper to start than a click. expo-image's disk cache
  // makes the work durable, so this doubles as offline warming.
  useEffect(() => {
    const index = slides.findIndex((s) => s.key === current?.key);
    if (index < 0) return;
    const urls = [index - 2, index - 1, index + 1, index + 2]
      .map((i) => slides[i])
      .filter((s): s is ViewerSlide => !!s && !s.local_uri && !!s.image_hash)
      .map((s) => bigThumbnailUrl(base, s.image_hash as string));
    if (urls.length === 0) return;
    // Guarded: the jest expo-image stub has no prefetch, and neither does an
    // older runtime — preloading is an optimization, never a requirement.
    void Image.prefetch?.(urls, { cachePolicy: "disk", headers });
  }, [slides, current?.key, base, headers]);

  /* ---- mutations ------------------------------------------------------- */

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
  const saveCaption = useCallback(
    (caption: string) => {
      if (hash) mutations.caption(hash, caption);
    },
    [hash, mutations]
  );
  const removeFromAlbum = useCallback(
    (album: PhotoAlbumRow) => {
      if (hash && summary) mutations.removeFromAlbum(album.id, album.title, [summary.id], [hash]);
    },
    [hash, summary, mutations]
  );
  const renamePerson = useCallback(
    (name: string) => {
      const person = renamingPerson;
      setRenamingPerson(null);
      if (!person) return;
      const personId = personIdByName(db, person.name);
      if (personId == null) {
        // Renaming needs the mirrored person row: the outbox payload is keyed by
        // person id, and the face payload only carries a name.
        pushToast({ level: "error", message: t("viewer.renameUnavailable") });
        return;
      }
      mutations.renamePerson(personId, name);
    },
    [renamingPerson, db, mutations, pushToast, t]
  );

  /* ---- online-only actions --------------------------------------------- */

  const togglePublic = useCallback(async () => {
    if (!hash || !flags) return;
    const next = flags.is_public === 0;
    try {
      await endpoints.setPhotosPublic(client, [hash], next);
      if (next) {
        await Clipboard.setStringAsync(bigThumbnailUrl(base, hash));
        pushToast({ level: "info", message: t("sharing.linkCopied") });
      } else {
        pushToast({ level: "info", message: t("sharing.shareSuccess") });
      }
    } catch {
      pushToast({ level: "error", message: t("sharing.shareError") });
    }
  }, [hash, flags, client, base, pushToast, t]);

  const submitTimestamp = useCallback(
    async (text: string) => {
      setEditingTimestamp(false);
      if (!hash) return;
      const parsed = parseEditableTimestamp(text);
      if (!parsed) {
        pushToast({ level: "error", message: t("viewer.timestampInvalid") });
        return;
      }
      try {
        await endpoints.setPhotoTimestamp(client, hash, parsed);
        pushToast({ level: "info", message: t("viewer.timestampSaved") });
      } catch {
        pushToast({ level: "error", message: t("viewer.timestampError") });
      }
    },
    [hash, client, pushToast, t]
  );

  /* ---- navigation ------------------------------------------------------ */

  const openPhoto = useCallback(
    (imageHash: string) => {
      const index = slides.findIndex((s) => s.image_hash === imageHash);
      if (index >= 0) {
        // Already in this pager's window — scroll rather than stack a screen.
        listRef.current?.scrollToIndex({ index, animated: true });
        setCurrentKey(slides[index].key);
        return;
      }
      router.push(`/photo/${imageHash}`);
    },
    [slides, router]
  );

  const openPerson = useCallback(
    (name: string) => {
      const personId = personIdByName(db, name);
      if (personId != null) router.push(`/(tabs)/albums/people/${personId}`);
      else router.push(`/(tabs)/search?q=${encodeURIComponent(name)}`);
    },
    [db, router]
  );

  const openAlbum = useCallback(
    (album: PhotoAlbumRow) => {
      router.push(
        album.kind === "user" ? `/(tabs)/albums/user/${album.id}` : `/(tabs)/albums/events/${album.id}`
      );
    },
    [router]
  );

  /* ---- render ---------------------------------------------------------- */

  const timestamp = summary?.timestamp ?? local?.created_at ?? null;
  const title = formatFullDate(timestamp, { locale: i18n.language }) || t("viewer.withoutTimestamp");
  const sheetOpen = detent !== "hidden";
  const actionBarHeight = 96 + insets.bottom;

  const renderSlide = useCallback(
    ({ item }: { item: ViewerSlide }) => {
      const active = item.key === current?.key;
      const toggleChrome = () => setChromeVisible((v) => !v);

      if (item.type === "video" && item.image_hash && !item.local_uri) {
        return (
          <VideoSlide
            testID={`viewer-video-${item.image_hash}`}
            uri={videoUrl(base, item.image_hash)}
            posterUri={bigThumbnailUrl(base, item.image_hash)}
            headers={headers}
            width={width}
            height={height}
            active={active}
            onTap={toggleChrome}
          />
        );
      }

      const face =
        active && highlightedFace != null
          ? detail.detail?.people?.find((p) => p.face_id === highlightedFace)
          : undefined;

      return (
        <ZoomableImage
          testID={`viewer-image-${item.image_hash ?? item.key}`}
          width={width}
          height={height}
          onTap={toggleChrome}
          source={sourceFor(item, base, headers, active && isAnimated(detail.detail?.image_path))}
          overlay={
            face ? (
              <FaceOverlay
                testID="viewer-face-overlay"
                location={face.location}
                sourceWidth={detail.detail?.width}
                sourceHeight={detail.detail?.height}
                boxWidth={width}
                boxHeight={height}
              />
            ) : null
          }
        />
      );
    },
    [current?.key, base, headers, width, height, highlightedFace, detail.detail]
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <FlashList
        ref={listRef}
        testID="viewer-pager"
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        keyExtractor={(s) => s.key}
        onViewableItemsChanged={onViewableItemsChanged}
        renderItem={renderSlide}
      />

      {chromeVisible ? (
        <ViewerTopBar
          title={title}
          subtitle={summary?.search_location ?? null}
          topInset={insets.top}
          infoOpen={sheetOpen}
          onClose={() => goBackOr(router, "/(tabs)/photos")}
          onToggleInfo={() => setDetent(sheetOpen ? "hidden" : "peek")}
        />
      ) : null}

      {chromeVisible && !sheetOpen ? (
        <ThumbnailStrip
          slides={slides}
          activeKey={current?.key}
          serverAddress={base}
          headers={headers}
          bottomOffset={flags ? actionBarHeight : insets.bottom}
          onSelect={(index) => {
            listRef.current?.scrollToIndex({ index, animated: true });
            setCurrentKey(slides[index].key);
          }}
        />
      ) : null}

      {/* No server row means no server-side flags to toggle — a bar full of
          no-ops is worse than no bar (doc 07 §1.4). */}
      {chromeVisible && !sheetOpen && flags ? (
        <ViewerActionBar
          isFavorite={flags.is_favorite === 1}
          hidden={flags.hidden === 1}
          inTrashcan={flags.in_trashcan === 1}
          isPublic={flags.is_public === 1}
          rating={flags.rating}
          isOnline={isOnline}
          bottomInset={insets.bottom}
          onToggleFavorite={toggleFavorite}
          onToggleHide={toggleHide}
          onToggleTrash={toggleTrash}
          onTogglePublic={() => void togglePublic()}
          onRate={rate}
        />
      ) : null}

      <PhotoInfoSheet
        detent={detent}
        onDetentChange={setDetent}
        summary={summary}
        local={local}
        detail={detail.detail}
        detailLoading={detail.isLoading}
        fromCache={detail.fromCache}
        albums={albums}
        serverAddress={base}
        headers={headers}
        isOnline={isOnline}
        mapsDisabled={mapsDisabled}
        onSaveCaption={saveCaption}
        onEditTimestamp={() => setEditingTimestamp(true)}
        onAddToAlbum={() => setPickingAlbum(true)}
        onRemoveFromAlbum={removeFromAlbum}
        onOpenAlbum={openAlbum}
        onRenamePerson={setRenamingPerson}
        onOpenPerson={openPerson}
        onReviewFaces={() => router.push("/(tabs)/profile/faces")}
        onHighlightFace={setHighlightedFace}
        highlightedFace={highlightedFace}
        onSearch={(term) => router.push(`/(tabs)/search?q=${encodeURIComponent(term)}`)}
        onOpenPhoto={openPhoto}
      />

      <TextPromptModal
        visible={editingTimestamp}
        title={t("viewer.editDateTime")}
        placeholder="YYYY-MM-DD HH:MM:SS"
        initialValue={toEditableTimestamp(timestamp)}
        submitLabel={t("common.save")}
        testID="viewer-timestamp-prompt"
        onSubmit={(value) => void submitTimestamp(value)}
        onCancel={() => setEditingTimestamp(false)}
      />

      <TextPromptModal
        visible={renamingPerson !== null}
        title={t("mutations.renamePerson")}
        placeholder={t("mutations.personName")}
        initialValue={renamingPerson?.name ?? ""}
        submitLabel={t("common.save")}
        testID="viewer-rename-person-prompt"
        onSubmit={renamePerson}
        onCancel={() => setRenamingPerson(null)}
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
        onCreate={(title_) => {
          setPickingAlbum(false);
          if (hash) {
            const photoId = remotePhotoIdByHash(db, hash);
            mutations.createAlbum(title_, photoId ? [photoId] : []);
          }
        }}
        onCancel={() => setPickingAlbum(false)}
      />
    </View>
  );
}

/** Does this slide answer to the given route param? */
function matchesId(slide: ViewerSlide, id: string): boolean {
  return (
    slide.key === id || slide.remote_id === id || slide.local_id === id || slide.image_hash === id
  );
}

/** Does this photo's file animate? Its big thumbnail would be a still frame. */
function isAnimated(paths: readonly string[] | undefined): boolean {
  return !!paths?.some((path) => path.toLowerCase().endsWith(".gif"));
}

/**
 * Local-first image source: the camera-roll file when we have it (instant, no
 * network, and the only option for a photo not yet uploaded), the server's big
 * thumbnail otherwise.
 *
 * `original` switches to the originals endpoint, which is how an animated GIF
 * actually animates — the big thumbnail is one frame. Only ever set for the
 * active slide, because originals are full-size files and a pager window holds
 * hundreds of them.
 */
function sourceFor(
  slide: ViewerSlide,
  base: string,
  headers: Record<string, string>,
  original = false
) {
  if (slide.local_uri) return { uri: slide.local_uri };
  if (!slide.image_hash) return { uri: "" };
  const wantsOriginal = original || slide.type === "motion_photo";
  const url = wantsOriginal
    ? photoUrl(base, slide.image_hash)
    : bigThumbnailUrl(base, slide.image_hash);
  return { uri: url, headers };
}
