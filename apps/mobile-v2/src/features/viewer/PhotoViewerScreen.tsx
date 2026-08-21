import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  squareThumbnailUrl,
  useApiClient,
  useSiteSettingsQuery,
  videoUrl,
  type People,
} from "@librephotos/api-client";
import { useDb, useReactiveQuery } from "@/db/provider";
import {
  albumsContainingPhoto,
  localAssetById,
  personIdByName,
  photoFlagsByHash,
  photoSummaryByHash,
  remotePhotoIdByHash,
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
import { useAfterFirstPaint } from "./useAfterFirstPaint";
import { useViewerWindow } from "./useViewerWindow";
import { seedSlideFromParams } from "./route";
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
 *
 * ## The first frame
 *
 * Device report: "clicking on a photo to open up a lightbox takes a while".
 * Nothing on the critical path to painting the tapped photo may touch the
 * timeline. The grid seeds the route with the slide it already has (`./route`),
 * so frame one is that photo and nothing else; the pager window (`useViewerWindow`),
 * the detail payload, the album rows and the neighbour prefetch all arrive after
 * it. See `useAfterFirstPaint` for what is deferred and why.
 */
export function PhotoViewerScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const routeId = params.id;
  // Frozen for the life of this screen instance: the viewer is opened at one
  // photo and pages from there, so a param identity change must not re-key the
  // pager.
  const [id] = useState(routeId);
  const [seed] = useState(() => seedSlideFromParams(params));
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

  const listRef = useRef<React.ComponentRef<typeof FlashList<ViewerSlide>>>(null);
  const ready = useAfterFirstPaint();

  // Pager context: a window of the timeline (mirror) *around* the tapped photo,
  // remote and local rows alike, extended as the user swipes. Starts as the one
  // seeded slide so the first frame owes the database nothing.
  const [currentIndex, setCurrentIndex] = useState(0);
  const { slides, restoreIndex, restored } = useViewerWindow({ id: id ?? "", seed, currentIndex });

  const current = useMemo(
    () => slides.find((s) => s.key === currentKey) ?? slides[currentIndex] ?? slides[0],
    [slides, currentKey, currentIndex]
  );
  const hash = current?.image_hash ?? null;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { key?: string | number | null; index?: number | null }[] }) => {
      const first = viewableItems[0];
      if (typeof first?.key === "string") setCurrentKey(first.key);
      if (typeof first?.index === "number") setCurrentIndex(first.index);
    }
  ).current;

  /**
   * The window grows at both ends, and growth at the *start* shifts every index
   * under the pager — FlashList only maintains visible content position for
   * vertical lists, so a horizontal pager has to re-anchor itself. Slides are
   * exactly one screen wide, so the target index is unambiguous. This also
   * covers the first hand-off, from the single seeded slide to the real window.
   */
  useLayoutEffect(() => {
    if (restoreIndex == null) return;
    if (restoreIndex !== currentIndex) {
      listRef.current?.scrollToIndex({ index: restoreIndex, animated: false });
      setCurrentIndex(restoreIndex);
    }
    restored();
    // `currentIndex` is the value being corrected, not an input to the correction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreIndex, restored]);

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
  // Album membership is sheet content, never first-frame content: a two-table
  // UNION for a surface the user has not opened yet.
  const albums = useReactiveQuery<PhotoAlbumRow[]>(
    (d) => (ready && summary ? albumsContainingPhoto(d, summary.id) : []),
    [ready, summary?.id]
  );

  // Deferred: this reads the cached payload off disk and runs it through zod,
  // then fetches over the network. None of that belongs in a mount render.
  const detail = usePhotoDetail(ready && flags ? (hash ?? undefined) : undefined);
  // Site settings decide whether the server wants maps shown at all — the same
  // `map_tile_provider === "none"` switch the web frontend honours.
  const settings = useSiteSettingsQuery();
  const mapsDisabled = settings.data?.map_tile_provider === "none";

  /* ---- neighbour preloading -------------------------------------------- */

  // The web lightbox preloads prev/main/next; mobile widens that to ±2 because
  // a swipe is faster and cheaper to start than a click. expo-image's disk cache
  // makes the work durable, so this doubles as offline warming. Deferred: it is
  // work for the *next* photo, and it competes with decoding this one.
  useEffect(() => {
    if (!ready) return;
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
  }, [ready, slides, current?.key, base, headers]);

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
        setCurrentIndex(index);
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
          placeholder={placeholderFor(item, base, headers)}
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
        // Read once, at FlashList's first layout. If the window has landed by
        // then (the common case) the pager opens on the tapped photo with no
        // scroll at all; if not, the layout effect above re-anchors it.
        initialScrollIndex={restoreIndex ?? currentIndex}
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
            setCurrentIndex(index);
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

/**
 * The square grid thumbnail of a remote slide — the exact image the grid was
 * showing a moment ago, so expo-image serves it from cache immediately while the
 * big thumbnail loads. A camera-roll slide already renders from its own file and
 * has nothing to wait for.
 */
function placeholderFor(slide: ViewerSlide, base: string, headers: Record<string, string>) {
  if (slide.local_uri || !slide.image_hash) return undefined;
  return { uri: squareThumbnailUrl(base, slide.image_hash), headers };
}
