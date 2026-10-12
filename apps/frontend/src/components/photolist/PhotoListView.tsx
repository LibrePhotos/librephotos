import { ActionIcon, Box, Group, RemoveScroll, Tooltip, useComputedColorScheme, useMantineTheme } from "@mantine/core";
import { useDisclosure, useViewportSize } from "@mantine/hooks";
import { IconLink, type TablerIcon } from "@tabler/icons-react";
import { useLocation } from "@tanstack/react-router";
import React, { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth/hooks";
import { mediaUrl } from "../../api_client/media/mediaUrl";
import type { BulkPhotoQuery, DatePhotosGroup, PigPhoto } from "../../api_client/photos/types";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE, TOP_MENU_HEIGHT } from "../../uiConstants";
import { formatDateForPhotoGroups } from "../../util/util";
import { EmptyState } from "../common/EmptyState";
import Pig from "../react-pig";
import type { PigHandle, PigVisibleGroup } from "../react-pig";
import { ScrollScrubber } from "../scrollscrubber/ScrollScrubber";
import { SCROLL_SCRUBBER_TARGET } from "../scrollscrubber/scrollScrubberTarget";
import { ScrollerType } from "../scrollscrubber/scrollScrubberTypes";
import { DefaultHeader } from "./DefaultHeader";
import type { MediaType } from "./mediaTypeFilter";
import { MediaTypeSelector } from "./MediaTypeSelector";
import { PhotoListDialogs } from "./PhotoListDialogs";
import { PhotoListDisplayMenu } from "./PhotoListDisplayMenu";
import { PhotoListSelectionBar } from "./PhotoListSelectionBar";
import { StackOverlay } from "./StackOverlay";
import { TopRightOverlay } from "./TopRightOverlay";
import { usePhotoListAlbumCover } from "./usePhotoListAlbumCover";
import { usePhotoListClick } from "./usePhotoListClick";
import { usePhotoListDialogs } from "./usePhotoListDialogs";
import { usePhotoListLightbox } from "./usePhotoListLightbox";
import { usePhotoListPreferences } from "./usePhotoListPreferences";
import { usePhotoListScrollScrubber } from "./usePhotoListScrollScrubber";
import { usePhotoListSelection } from "./usePhotoListSelection";
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
  // Replaces the default header (title, counts, display menu) in the sticky bar above the grid;
  // null leaves the bar out, for a list under its page's own header (the shared photo pages).
  header?: React.ReactNode;
  additionalSubHeader?: React.ReactNode;
  albumID?: string;
  ownerUsername?: string;
  albumLocked?: boolean;
  emptyStateConfig?: EmptyStateConfig;
  // Query params for server-side select all
  photosetQuery?: BulkPhotoQuery;
  // When set, an All/Photos/Videos filter is shown in the header. The value is
  // the current selection (from the route's `?media` param) — passing it keeps
  // the memoized grid re-rendering when the filter changes.
  mediaType?: MediaType;
  // Extra controls for the header's right-hand toolbar, before the display
  // options (the main timeline's Filter button). Shown even when the view is
  // empty, so a filter that matches nothing can always be changed back.
  headerActions?: React.ReactNode;
  // Scrolls away above the grid, unlike the sticky header (the timeline's memories).
  banner?: React.ReactNode;
}>;

function PhotoListViewComponent({
  title = "",
  loading = true,
  icon,
  photoset = [],
  idx2hash = [],
  selectable = false,
  isPublic = false,
  isAlbumPubliclyShared = false,
  publicAlbumSlug,
  numberOfItems = 0,
  updateGroups,
  updateItems,
  date,
  dayHeaderPrefix,
  header,
  additionalSubHeader,
  albumID,
  ownerUsername,
  albumLocked = false,
  emptyStateConfig,
  photosetQuery,
  mediaType,
  headerActions,
  banner,
}: Props) {
  const { t } = useTranslation();
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

  // Check if we're in first-time setup mode (DefaultHeader shows setup dialog)
  // Don't show EmptyState in this case to avoid duplicate messages
  const isFirstTimeSetup =
    !isLoading && auth?.access && location.pathname === "/" && auth.access.is_admin && !userSelfDetails?.scan_directory;

  const {
    localImageScale,
    localTextAlignment,
    localHeaderSize,
    handleThumbnailSizeChange,
    handleTextAlignmentChange,
    handleHeaderSizeChange,
  } = usePhotoListPreferences(userSelfDetails);
  const [displayMenuOpened, { open: openDisplayMenu, close: closeDisplayMenu }] = useDisclosure(false);

  const lightbox = usePhotoListLightbox(idx2hash, pigRef, gridRef);

  const isDateView = photoset !== idx2hash;
  // Pig re-lays-out the whole grid whenever `imageData` changes identity, so
  // only re-format the date groups when the photoset itself changes.
  const photos = useMemo(
    () => (isDateView && isDateGroupList(photoset) ? formatDateForPhotoGroups(photoset) : photoset),
    [isDateView, photoset]
  );

  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme("light");
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
  const { setAlbumCover, onSelectCover } = usePhotoListAlbumCover(albumID, selectionState.selectedItems, dialogs);
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
  const getNumPhotos = () => (idx2hash ? idx2hash.length : 0);
  const isUserAlbum = location.pathname.startsWith("/album/user/");
  // headerActions stay mounted while the view reloads: changing the timeline
  // filter refetches, and an open filter popover must not close under the
  // pointer. The other controls wait for the photos.
  const showHeaderToolbar =
    !isPublic &&
    !isFirstTimeSetup &&
    (!!headerActions || (!isLoading && (getNumPhotos() > 0 || mediaType !== undefined)));

  return (
    <RemoveScroll enabled={lightbox.lightboxOpen}>
      {header !== null && (
        <Box
          style={{
            boxSizing: "border-box",
            cursor: "pointer",
            padding: 6,
            position: "sticky",
            top: TOP_MENU_HEIGHT,
            width: "100%",
            zIndex: 10,
            backgroundColor: colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0],
          }}
        >
          {header || (
            // The actions sit beside the title in the normal flow (they used to be
            // absolutely positioned over it). The 260px basis wraps a wide action
            // group onto its own row on phones instead of squeezing the title.
            <Group justify="space-between" align="flex-start" gap="xs" style={{ rowGap: 4 }}>
              <Box style={{ flex: "1 1 260px", minWidth: 0 }}>
                <DefaultHeader
                  loading={isLoading}
                  numPhotosetItems={photos.length || 0}
                  numPhotos={getNumPhotos()}
                  icon={icon}
                  title={title}
                  dayHeaderPrefix={dayHeaderPrefix}
                  date={date}
                  additionalSubHeader={additionalSubHeader}
                  hasEmptyState={!!emptyStateConfig && !isFirstTimeSetup}
                  isPublic={isPublic}
                  countsVideos={mediaType === "videos" || location.pathname.startsWith("/videos")}
                />
              </Box>
              {showHeaderToolbar && (
                <Box ml="auto">
                  <Group gap="xs" wrap="nowrap">
                    {/* The media-type filter stays visible even when the current
                      filter yields no photos, so the user is never trapped. */}
                    {!isLoading && mediaType !== undefined && <MediaTypeSelector />}
                    {headerActions}
                    {!isLoading && getNumPhotos() > 0 && isAlbumPubliclyShared && isUserAlbum && (
                      <Tooltip label={t("sidemenu.sharing")} position="bottom">
                        <ActionIcon
                          variant="default"
                          size={TOOLBAR_ACTION_SIZE}
                          aria-label={t("sidemenu.sharing")}
                          onClick={() => dialogs.albumShare.open()}
                        >
                          <IconLink size={ICON_SIZE.toolbar} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                    {!isLoading && getNumPhotos() > 0 && (
                      <PhotoListDisplayMenu
                        displayMenuOpened={displayMenuOpened}
                        openDisplayMenu={openDisplayMenu}
                        closeDisplayMenu={closeDisplayMenu}
                        localImageScale={localImageScale}
                        localTextAlignment={localTextAlignment}
                        localHeaderSize={localHeaderSize}
                        onThumbnailSizeChange={handleThumbnailSizeChange}
                        onTextAlignmentChange={handleTextAlignmentChange}
                        onHeaderSizeChange={handleHeaderSizeChange}
                      />
                    )}
                  </Group>
                </Box>
              )}
            </Group>
          )}
          {!isLoading && !isPublic && getNumPhotos() > 0 && (
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
            />
          )}
        </Box>
      )}
      {banner}
      {!isLoading && photos && photos.length > 0 ? (
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
              selectable={selectable === undefined || selectable}
              selectedItems={pigSelectedItems}
              handleSelection={handleSelection}
              handleClick={handleClick}
              scaleOfImages={localImageScale}
              groupByDate={isDateView}
              getUrl={getTileUrl}
              toprightoverlay={TopRightOverlay}
              bottomleftoverlay={StackOverlay}
              bottomrightoverlay={VideoOverlay}
              numberOfItems={numberOfItems ?? idx2hashRef.current.length}
              updateItems={updateItems ? throttledUpdateItems : noop}
              updateGroups={updateGroups ? throttledUpdateGroups : noop}
              bgColor="inherit"
              textAlignment={localTextAlignment}
              headerSize={localHeaderSize}
            />
          </Box>
        </ScrollScrubber>
      ) : !isLoading && emptyStateConfig && !isFirstTimeSetup ? (
        <EmptyState
          icon={emptyStateConfig.icon}
          title={emptyStateConfig.title}
          description={emptyStateConfig.description}
          actionLabel={emptyStateConfig.actionLabel}
          actionLink={emptyStateConfig.actionLink}
          onAction={emptyStateConfig.onAction}
          progress={emptyStateConfig.progress}
        />
      ) : (
        <div />
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
        publicAlbumSlug={publicAlbumSlug}
        isPublic={isPublic}
        isUserAlbum={isUserAlbum}
        albumID={albumID}
        title={title}
        idx2hash={idx2hash}
        totalCount={totalCount}
        selectionState={selectionState}
        updateSelectionState={updateSelectionState}
        onSelectCover={onSelectCover}
      />
    </RemoveScroll>
  );
}

// Default shallow comparison: a custom comparator that only looked at a few
// props silently dropped changes to title, photoset, header, emptyStateConfig,
// updateGroups, etc. Callers should pass stable (memoised) props.
export const PhotoListView = React.memo(PhotoListViewComponent);
