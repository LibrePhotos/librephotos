import type { BulkPhotoQuery, DatePhotosGroup, MediaType, PigPhoto, User } from "@librephotos/api-client";
import { Box, Flex, RemoveScroll } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import type { TablerIcon } from "@tabler/icons-react";
import { useLocation } from "@tanstack/react-router";
import React, { useEffect, useMemo, useRef } from "react";
import { useAccessToken } from "../../api_client/auth/hooks";
import { mediaUrl } from "../../api_client/media/mediaUrl";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { TOP_MENU_HEIGHT } from "../../uiConstants";
import { formatDateForPhotoGroups, type GroupNote } from "../../util/util";
import type { ListFailure } from "../common/useListFailure";
import Pig from "../react-pig";
import type { PigHandle, PigVisibleGroup } from "../react-pig";
import { ScrollScrubber } from "../scrollscrubber/ScrollScrubber";
import { SCROLL_SCRUBBER_TARGET } from "../scrollscrubber/scrollScrubberTarget";
import { ScrollerType } from "../scrollscrubber/scrollScrubberTypes";
import { DefaultHeader } from "./DefaultHeader";
import { MediaTypeHint } from "./MediaTypeHint";
import { PhotoListDialogs } from "./PhotoListDialogs";
import { PhotoListFallback } from "./PhotoListFallback";
import { PhotoListSelectionBar } from "./PhotoListSelectionBar";
import { PhotoListToolbar } from "./PhotoListToolbar";
import classes from "./PhotoListView.module.css";
import { StackOverlay } from "./StackOverlay";
import { TopRightOverlay } from "./TopRightOverlay";
import { usePhotoListAlbumCover } from "./usePhotoListAlbumCover";
import { usePhotoListClick } from "./usePhotoListClick";
import { usePhotoListDialogs } from "./usePhotoListDialogs";
import { usePhotoListLightbox } from "./usePhotoListLightbox";
import { usePhotoListPreferences } from "./usePhotoListPreferences";
import { usePhotoListScrollScrubber } from "./usePhotoListScrollScrubber";
import { usePhotoListSelection } from "./usePhotoListSelection";
import { usePhotoListSelectMode } from "./usePhotoListSelectMode";
import { usePhotoListSlideshow } from "./usePhotoListSlideshow";
import { usePhotoListThrottledUpdates } from "./usePhotoListThrottledUpdates";
import { VideoOverlay } from "./VideoOverlay";

const TIMELINE_SCROLL_WIDTH = 0;

// Pig calls updateGroups/updateItems unconditionally; a module-level no-op keeps
// the prop identity stable when the caller did not pass one.
const noop = () => {};

const scrollToY = (y: number) => {
  window.scrollTo(0, y);
};

// Date views pass the groups as `photoset` and the flat list as `idx2hash`;
// flat views pass the one list as both.
const isDateGroupList = (photoset: DatePhotosGroup[] | PigPhoto[]): photoset is DatePhotosGroup[] =>
  photoset.every(entry => "items" in entry);

// Pig passes a tile's `image_hash`.
const getTileUrl = (imageHash: string, pxHeight: number) => {
  if (pxHeight < 250) {
    return mediaUrl.squareThumbnailSmall(imageHash);
  }
  // Always use the highest quality thumbnails for better image quality
  return mediaUrl.squareThumbnail(imageHash);
};

export type { PhotoGroup } from "./photoGroup";
// The pages that load their own date groups read the visible ones in the shape Pig reports.
export type { GroupedImageItem, PigHandle, PigVisibleGroup } from "../react-pig";

export type EmptyStateConfig = {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  actionLink?: string;
  onAction?: () => void;
  progress?: {
    current: number;
    target: number;
  };
  /** Framed as a place to drop files on (an empty album, #612). */
  dropZone?: boolean;
};

type Props = Readonly<{
  title: string;
  loading: boolean;
  icon: TablerIcon;
  photoset: DatePhotosGroup[] | PigPhoto[];
  idx2hash: PigPhoto[];
  selectable: boolean;
  isPublic?: boolean;
  isAlbumPubliclyShared?: boolean;
  publicAlbumSlug?: string;
  numberOfItems?: number;
  // Pig reports the groups (date views) or tiles (flat views) on screen, so
  // the caller can load the pages their placeholders stand for.
  updateGroups?: (visibleGroups: PigVisibleGroup<PigPhoto>[]) => void;
  updateItems?: (visibleItems: PigPhoto[]) => void;
  date?: string;
  dayHeaderPrefix?: string;
  // A dimmed note beside each dated group's heading, from its day: a person's age (#2751).
  // Keep it stable (useCallback): a new function lays the grid out again.
  groupNote?: GroupNote;
  // Replaces the default header (title, counts, display menu) in the sticky bar above the grid;
  // null leaves the bar out, for a list under its page's own header (the shared photo pages).
  header?: React.ReactNode;
  // 2 for a list under its page's own header that keeps the default header for its selection
  // bar (the Photos tab of the public links page): the list's title becomes an h2, so the page
  // keeps one h1. Looks the same.
  titleOrder?: 1 | 2;
  additionalSubHeader?: React.ReactNode;
  // After the title, inside the heading: a user album's "Locked" badge.
  titleBadge?: React.ReactNode;
  albumID?: string;
  ownerUsername?: string;
  albumLocked?: boolean;
  emptyStateConfig?: EmptyStateConfig;
  // The photo list's request failed before any photos arrived (`useListFailure`):
  // shown instead of the empty state, which would claim the library is empty.
  error?: ListFailure;
  // Query params for server-side select all
  photosetQuery?: BulkPhotoQuery;
  // When set, an All/Photos/Videos filter is shown in the header. The value is
  // the current selection (from the route's `?media` param) — passing it keeps
  // the memoized grid re-rendering when the filter changes.
  mediaType?: MediaType;
  // Extra controls for the header's right-hand toolbar, before the display
  // options (the main timeline's Filter button). Shown even when the view is
  // empty, so a filter that matches nothing can always be changed back, and on
  // a view that is otherwise read-only (`isPublic`): leaving a shared album.
  headerActions?: React.ReactNode;
  // Under the title row, full width, also while the view loads or is empty: the search page's
  // active filter chips, so a filter that matches nothing can be removed where it shows.
  filterBar?: React.ReactNode;
  // Scrolls away above the grid, unlike the sticky header (the timeline's memories).
  banner?: React.ReactNode;
  // Opens the lightbox on the first photo, playing, once the photos are there (a public album's
  // `?slideshow=1`, #1457); onSlideshowClose runs when the viewer closes that slideshow.
  slideshow?: boolean;
  onSlideshowClose?: () => void;
}>;

// An admin's empty timeline before a scan directory is set: DefaultHeader shows the setup
// welcome, so the empty state stays out (two messages otherwise).
function isFirstTimeSetupView(
  isLoading: boolean,
  pathname: string,
  auth: ReturnType<typeof useAccessToken>["data"],
  userSelfDetails: Pick<User, "scan_directory"> | undefined
): boolean {
  if (isLoading || pathname !== "/" || !auth?.access?.is_admin) return false;
  return !userSelfDetails?.scan_directory;
}

function PhotoListViewComponent({
  title,
  loading,
  icon,
  photoset,
  idx2hash,
  selectable,
  isPublic = false,
  isAlbumPubliclyShared = false,
  publicAlbumSlug,
  numberOfItems = 0,
  updateGroups,
  updateItems,
  date,
  dayHeaderPrefix,
  groupNote,
  header,
  titleOrder,
  additionalSubHeader,
  titleBadge,
  albumID,
  ownerUsername,
  albumLocked = false,
  emptyStateConfig,
  error,
  photosetQuery,
  mediaType,
  headerActions,
  filterBar,
  banner,
  slideshow = false,
  onSlideshowClose,
}: Props) {
  const { height } = useViewportSize();
  const pigRef = useRef<PigHandle<PigPhoto>>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  // Skip user details query on public pages
  const { data: userSelfDetails, isLoading: userDetailsLoading } = useCurrentUserSelfDetailsQuery(isPublic);
  const { data: auth } = useAccessToken();

  // Combined loading state - wait for both parent loading and user details (skip on public pages)
  const isLoading = loading || (!isPublic && userDetailsLoading);
  const { dataForScrollIndicator, gridHeight } = usePhotoListScrollScrubber(isLoading, pigRef);

  const isFirstTimeSetup = isFirstTimeSetupView(isLoading, location.pathname, auth, userSelfDetails);

  const preferences = usePhotoListPreferences(userSelfDetails);
  const { localImageScale, localTextAlignment, localHeaderSize } = preferences;

  const lightbox = usePhotoListLightbox(idx2hash, pigRef, gridRef, { ready: !isLoading, isPublic });
  const slideshowState = usePhotoListSlideshow(idx2hash, lightbox, { slideshow, ready: !isLoading, onSlideshowClose });

  const isDateView = photoset !== idx2hash;
  // Pig re-lays-out the whole grid whenever `imageData` changes identity, so
  // only re-format the date groups when the photoset itself changes.
  const photos = useMemo(
    () => (isDateView && isDateGroupList(photoset) ? formatDateForPhotoGroups(photoset, groupNote) : photoset),
    [isDateView, photoset, groupNote]
  );

  const idx2hashRef = useRef(idx2hash);

  useEffect(() => {
    idx2hashRef.current = idx2hash;
  }, [idx2hash]);

  const { throttledUpdateGroups, throttledUpdateItems } = usePhotoListThrottledUpdates(updateGroups, updateItems);

  const {
    selectionState,
    selectionStateRef,
    updateSelectionState,
    handleSelection,
    handleSelections,
    pigSelectedItems,
  } = usePhotoListSelection(idx2hash, mediaType, photosetQuery);
  const dialogs = usePhotoListDialogs(isPublic, selectionStateRef);
  const setAlbumCover = usePhotoListAlbumCover(albumID, selectionState.selectedItems);
  const selectMode = usePhotoListSelectMode(selectionState, updateSelectionState, !lightbox.lightboxOpen);
  const totalCount = selectionState.totalCount || numberOfItems || idx2hash.length;

  const handleClick = usePhotoListClick({
    idx2hashRef,
    selectable,
    selectionStateRef,
    handleSelection,
    handleSelections,
    currentImageIndexRef: lightbox.currentImageIndexRef,
    showLightbox: lightbox.showLightbox,
  });

  // Use live prop length so UI reflects data availability immediately on load
  const getNumPhotos = () => idx2hash.length;
  const isUserAlbum = location.pathname.startsWith("/album/user/");

  return (
    <RemoveScroll enabled={lightbox.lightboxOpen}>
      {header !== null && (
        <Box className={classes.header}>
          {header || (
            // The actions sit beside the title in the normal flow (they used to be
            // absolutely positioned over it). The 220px basis wraps a wide action
            // group onto its own row on phones instead of squeezing the title, and
            // keeps the timeline's three icons (Filter, Select, display) beside it.
            <Flex justify="space-between" align="flex-start" columnGap="xs" rowGap={4} wrap="wrap">
              <Box flex="1 1 220px" miw={0}>
                <DefaultHeader
                  loading={isLoading}
                  numPhotosetItems={photos.length || 0}
                  numPhotos={getNumPhotos()}
                  icon={icon}
                  title={title}
                  titleBadge={titleBadge}
                  dayHeaderPrefix={dayHeaderPrefix}
                  date={date}
                  additionalSubHeader={additionalSubHeader}
                  hasEmptyState={!!emptyStateConfig && !isFirstTimeSetup}
                  isPublic={isPublic}
                  countsVideos={mediaType === "videos" || location.pathname.startsWith("/videos")}
                  titleOrder={titleOrder}
                  filterHint={mediaType === undefined ? undefined : <MediaTypeHint />}
                />
              </Box>
              {!isFirstTimeSetup && (
                <PhotoListToolbar
                  headerActions={headerActions}
                  listControls={!isLoading && !isPublic}
                  hasPhotos={getNumPhotos() > 0}
                  mediaFilter={mediaType !== undefined}
                  publicLink={isAlbumPubliclyShared && isUserAlbum}
                  onOpenSharing={() => dialogs.albumShare.open()}
                  preferences={preferences}
                  selectMode={
                    selectable
                      ? {
                          selecting: selectMode.selecting,
                          onToggle: selectMode.toggle,
                          ref: selectMode.selectButtonRef,
                        }
                      : undefined
                  }
                />
              )}
            </Flex>
          )}
          {header === undefined && filterBar}
          {!isLoading && !isPublic && getNumPhotos() > 0 && selectMode.selecting && (
            <PhotoListSelectionBar
              selectionState={selectionState}
              idx2hash={idx2hash}
              updateSelectionState={updateSelectionState}
              photosetQuery={photosetQuery}
              totalCount={totalCount}
              albumID={albumID}
              ownerUsername={ownerUsername}
              albumLocked={albumLocked}
              title={title}
              setAlbumCover={setAlbumCover}
              dialogs={dialogs}
              onClose={selectMode.exit}
              closeRef={selectMode.closeButtonRef}
            />
          )}
        </Box>
      )}
      {banner}
      {!isLoading && photos.length > 0 ? (
        <ScrollScrubber
          scrollPositions={dataForScrollIndicator}
          scrollToY={scrollToY}
          targetHeight={gridHeight.current}
          type={ScrollerType.enum.date}
        >
          <Box p={10} ref={gridRef}>
            <Pig<PigPhoto>
              ref={pigRef}
              className={SCROLL_SCRUBBER_TARGET}
              imageData={photos}
              selectable={selectable}
              selectedItems={pigSelectedItems}
              handleSelection={handleSelection}
              handleClick={handleClick}
              scaleOfImages={localImageScale}
              groupByDate={isDateView}
              getUrl={getTileUrl}
              toprightoverlay={TopRightOverlay}
              bottomleftoverlay={StackOverlay}
              bottomrightoverlay={VideoOverlay}
              numberOfItems={numberOfItems}
              updateItems={updateItems ? throttledUpdateItems : noop}
              updateGroups={updateGroups ? throttledUpdateGroups : noop}
              bgColor="inherit"
              textAlignment={localTextAlignment}
              headerSize={localHeaderSize}
            />
          </Box>
        </ScrollScrubber>
      ) : (
        <PhotoListFallback
          isLoading={isLoading}
          error={error}
          emptyStateConfig={emptyStateConfig}
          isFirstTimeSetup={isFirstTimeSetup}
        />
      )}

      <div
        style={{
          position: "fixed",
          right: 0,
          height: height - TOP_MENU_HEIGHT,
          width: TIMELINE_SCROLL_WIDTH,
        }}
      />

      <PhotoListDialogs
        dialogs={dialogs}
        lightbox={lightbox}
        slideshow={slideshowState}
        publicAlbumSlug={publicAlbumSlug}
        isPublic={isPublic}
        isUserAlbum={isUserAlbum}
        albumID={albumID}
        idx2hash={idx2hash}
        totalCount={totalCount}
        selectionState={selectionState}
        updateSelectionState={updateSelectionState}
      />
    </RemoveScroll>
  );
}

// Default shallow comparison: a custom comparator that only looked at a few
// props silently dropped changes to title, photoset, header, emptyStateConfig,
// updateGroups, etc. Callers should pass stable (memoised) props.
export const PhotoListView = React.memo(PhotoListViewComponent);
