import {
  ActionIcon,
  Box,
  Group,
  Menu,
  RemoveScroll,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useDebouncedCallback, useHotkeys, useViewportSize } from "@mantine/hooks";
import { IconLink, IconSettings } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { throttle } from "lodash-es";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetPersonAlbumCoverMutation, useSetUserAlbumCoverMutation } from "../../api_client/albums/hooks";
import { serverAddress } from "../../api_client/apiClient";
import { useAccessToken } from "../../api_client/auth/hooks";
import { BulkPhotoQuery, DatePhotosGroup, PigPhoto, SelectionState } from "../../api_client/photos/types";
import {
  useCurrentUserSelfDetailsQuery,
  UserSelfDetailsQueryKeys,
  useUpdateUserMutation,
} from "../../api_client/user/hooks";
import type { User } from "../../api_client/user/types";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { formatDateForPhotoGroups } from "../../util/util";
import { EmptyState } from "../common/EmptyState";
import { Lightbox } from "../lightbox/Lightbox";
import { AlbumCoverPickerModal } from "../modals/AlbumCoverPickerModal";
import { AlbumEditModal } from "../modals/AlbumEdit/AlbumEditModal";
import { ModalTagEdit } from "../modals/ModalTagEdit";
import Pig from "../react-pig";
import type { PigHandle } from "../react-pig";
import { ScrollScrubber } from "../scrollscrubber/ScrollScrubber";
import { ScrollerType } from "../scrollscrubber/ScrollScrubberTypes.zod";
import type { ScrollerData } from "../scrollscrubber/ScrollScrubberTypes.zod";
import { ModalAlbumShare } from "../sharing/ModalAlbumShare";
import { ModalPhotosShare } from "../sharing/ModalPhotosShare";
import { DefaultHeader } from "./DefaultHeader";
import type { MediaType } from "./mediaTypeFilter";
import { MediaTypeSelector } from "./MediaTypeSelector";
import { SelectionActions } from "./SelectionActions";
import { SelectionBar } from "./SelectionBar";
import { StackOverlay } from "./StackOverlay";
import { TopRightOverlay } from "./TopRightOverlay";
import { TrashcanActions } from "./TrashcanActions";
import { VideoOverlay } from "./VideoOverlay";

const TIMELINE_SCROLL_WIDTH = 0;

// Pig calls updateGroups/updateItems unconditionally; a module-level no-op keeps
// the prop identity stable when the caller did not pass one.
const noop = () => {};

const scrollToY = (y: number) => {
  window.scrollTo(0, y);
};

// Layout data Pig attaches to each date group (see react-pig computeLayoutGroups).
type PigGroupLayout = DatePhotosGroup & { groupTranslateY: number };

type HeaderSize = "large" | "normal" | "small";

export type PhotoGroup = {
  id: string;
  page: number;
  items?: PigPhoto[];
};

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
  icon: any;
  photoset: any[];
  idx2hash: any[];
  selectable: boolean;
  isPublic?: boolean;
  isAlbumPubliclyShared?: boolean;
  publicAlbumSlug?: string;
  numberOfItems?: number;
  updateGroups?: any;
  updateItems?: any;
  date?: any;
  dayHeaderPrefix?: any;
  header?: any;
  additionalSubHeader?: any;
  albumID?: string;
  ownerUsername?: string;
  emptyStateConfig?: EmptyStateConfig;
  // Query params for server-side select all
  photosetQuery?: BulkPhotoQuery;
  // When set, an All/Photos/Videos filter is shown in the header. The value is
  // the current selection (from the route's `?media` param) — passing it keeps
  // the memoized grid re-rendering when the filter changes.
  mediaType?: MediaType;
}>;

// SelectionState is now imported from api_client/photos/types

function PhotoListViewComponent({
  title = "",
  loading = true,
  icon = null,
  photoset = [],
  idx2hash = [],
  selectable = false,
  isPublic = false,
  isAlbumPubliclyShared = false,
  publicAlbumSlug,
  numberOfItems = 0,
  updateGroups = null,
  updateItems = null,
  date = null,
  dayHeaderPrefix = null,
  header = null,
  additionalSubHeader = null,
  albumID,
  ownerUsername,
  emptyStateConfig,
  photosetQuery,
  mediaType,
}: Props) {
  const { t } = useTranslation();
  const { height } = useViewportSize();
  const pigRef = useRef<PigHandle>(null);
  const [modalAddToAlbumOpen, setModalAddToAlbumOpen] = useState(false);
  const [modalTagOpen, setModalTagOpen] = useState(false);
  const [modalSharePhotosOpen, setModalSharePhotosOpen] = useState(false);
  const [modalAlbumShareOpen, setModalAlbumShareOpen] = useState(false);
  const [modalCoverPickerOpen, setModalCoverPickerOpen] = useState(false);
  const [coverPickerAlbumType, setCoverPickerAlbumType] = useState<"person" | "useralbum" | null>(null);
  const [selectionState, setSelectionState] = useState<SelectionState>({
    selectedItems: [],
    selectMode: false,
    selectAllMode: false,
    selectAllQuery: undefined,
    totalCount: undefined,
  });
  const selectionStateRef = useRef(selectionState);
  const [dataForScrollIndicator, setDataForScrollIndicator] = useState<ScrollerData[]>([]);
  const gridHeight = useRef(200);
  const gridRef = useRef<HTMLDivElement>(null);
  const setUserAlbumCover = useSetUserAlbumCoverMutation();
  const setPersonAlbumCover = useSetPersonAlbumCoverMutation();
  // Silent: the debounced grid preference saves would otherwise pop an "Update user" toast.
  const updateUser = useUpdateUserMutation({ silent: true });
  const queryClient = useQueryClient();
  const location = useLocation();
  // Skip user details query on public pages
  const { data: userSelfDetails, isLoading: userDetailsLoading } = useCurrentUserSelfDetailsQuery(isPublic);
  const { data: auth } = useAccessToken();

  // Combined loading state - wait for both parent loading and user details (skip on public pages)
  const isLoading = loading || (!isPublic && userDetailsLoading);

  // Check if we're in first-time setup mode (DefaultHeader shows setup dialog)
  // Don't show EmptyState in this case to avoid duplicate messages
  const isFirstTimeSetup =
    !isLoading && auth?.access && location.pathname === "/" && auth.access.is_admin && !userSelfDetails?.scan_directory;

  const imageScale = userSelfDetails?.image_scale ?? 1;
  const textAlignment = (userSelfDetails?.text_alignment as "left" | "right") ?? "right";
  const headerSize = (userSelfDetails?.header_size as HeaderSize) ?? "large";

  const [localImageScale, setLocalImageScale] = useState(imageScale);
  const [localTextAlignment, setLocalTextAlignment] = useState<"left" | "right">(textAlignment);
  const [localHeaderSize, setLocalHeaderSize] = useState<HeaderSize>(headerSize);
  const [displayMenuOpened, setDisplayMenuOpened] = useState(false);

  const currentImageIndexRef = useRef(0);
  const navigate = useNavigate();

  // Simple lightbox state management
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImageId, setLightboxImageId] = useState("");

  const showLightbox = useCallback((imageId: string, isValid: boolean) => {
    if (isValid) {
      setLightboxImageId(imageId);
      setLightboxOpen(true);
    }
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    setLightboxImageId("");
  }, []);

  const handleLightboxIndexChange = useCallback(
    (currentIndex?: number) => {
      // Update the current image index if provided from lightbox
      if (currentIndex !== undefined) {
        currentImageIndexRef.current = currentIndex;
      }

      // Scroll to the current image's position
      if (pigRef.current && idx2hash[currentImageIndexRef.current]) {
        // Use setTimeout to ensure DOM is updated after lightbox is closed
        setTimeout(() => {
          // Read the tile's position from Pig's layout rather than the DOM: the
          // grid is virtualised, so the tile may not be rendered, and video
          // tiles have no <img> to match on (the old index fallback then
          // pointed at an unrelated tile).
          const currentId = idx2hash[currentImageIndexRef.current]?.id;
          const layout = (pigRef.current?.imageData ?? []).flatMap((entry: any) => entry.items ?? [entry]);
          const tile = layout.find((entry: any) => entry.id === currentId);
          const grid = gridRef.current;
          if (!tile?.style || !grid) return;
          // Pig is the grid wrapper's only child, inside its padding.
          const pig = grid.firstElementChild ?? grid;
          const tileTop = pig.getBoundingClientRect().top + window.scrollY + tile.style.translateY;
          // Centre the tile, so it is not left under the sticky header.
          window.scrollTo({
            top: Math.max(0, tileTop - (window.innerHeight - tile.style.height) / 2),
            behavior: "smooth",
          });
        }, 100);
      }
    },
    [idx2hash]
  );

  const handleLightboxImageChange = useCallback((imageId: string) => {
    setLightboxImageId(imageId);
  }, []);

  const isDateView = photoset !== idx2hash;
  // Pig re-lays-out the whole grid whenever `imageData` changes identity, so
  // only re-format the date groups when the photoset itself changes.
  const photos = useMemo(() => (isDateView ? formatDateForPhotoGroups(photoset) : photoset), [isDateView, photoset]);

  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme("light");
  const idx2hashRef = useRef(idx2hash);

  useEffect(() => {
    idx2hashRef.current = idx2hash;
  }, [idx2hash]);

  useEffect(() => {
    setLocalImageScale(imageScale);
    setLocalTextAlignment(textAlignment);
    setLocalHeaderSize(headerSize);
  }, [imageScale, textAlignment, headerSize]);

  // Only the changed preferences are sent: echoing the whole profile back sent
  // the avatar URL, which the backend rejects as "not a file" (#2153). Changes
  // made within one debounce window are merged so none of them is dropped.
  const pendingPreferences = useRef<Partial<User>>({});
  const flushPreferences = useDebouncedCallback(() => {
    const changes = pendingPreferences.current;
    pendingPreferences.current = {};
    const userId = userSelfDetails?.id;
    if (userId) {
      updateUser.mutate(
        { id: userId, ...changes },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: UserSelfDetailsQueryKeys });
          },
        }
      );
    }
  }, 500);
  const debouncedSavePreferences = (partial: Partial<User>) => {
    pendingPreferences.current = { ...pendingPreferences.current, ...partial };
    flushPreferences();
  };

  const handleThumbnailSizeChange = (value: number) => {
    setLocalImageScale(value);
    debouncedSavePreferences({ image_scale: value });
  };

  const handleTextAlignmentChange = (alignment: "left" | "right") => {
    setLocalTextAlignment(alignment);
    debouncedSavePreferences({ text_alignment: alignment });
  };

  const handleHeaderSizeChange = (size: HeaderSize) => {
    setLocalHeaderSize(size);
    debouncedSavePreferences({ header_size: size });
  };

  // The throttled wrappers must keep one identity (a new throttle per render
  // would never throttle), but must call the caller's *latest* callback: parents
  // pass closures over their current state, and calling the first-render one
  // forever fetches with stale state.
  const updateGroupsRef = useRef(updateGroups);
  const updateItemsRef = useRef(updateItems);
  // Layout effect: Pig reports visible groups from its own (passive) effects,
  // which run before this component's passive effects on the same commit.
  useLayoutEffect(() => {
    updateGroupsRef.current = updateGroups;
    updateItemsRef.current = updateItems;
  }, [updateGroups, updateItems]);

  const throttledUpdateGroups = useMemo(
    () => throttle((visibleGroups: unknown) => updateGroupsRef.current?.(visibleGroups), 500),
    []
  );
  const throttledUpdateItems = useMemo(
    () => throttle((visibleItems: unknown) => updateItemsRef.current?.(visibleItems), 500),
    []
  );
  useEffect(
    () => () => {
      throttledUpdateGroups.cancel();
      throttledUpdateItems.cancel();
    },
    [throttledUpdateGroups, throttledUpdateItems]
  );

  const getUrl = useCallback((item: any, pxHeight: number) => {
    const url = typeof item === "string" ? item : item.url;
    if (pxHeight < 250) {
      return `${serverAddress}/media/square_thumbnails_small/${url.split(";")[0]}`;
    }
    // Always use the highest quality thumbnails for better image quality
    return `${serverAddress}/media/square_thumbnails/${url.split(";")[0]}`;
  }, []);

  // Merge into the ref, not the render-time `selectionState`: callers such as
  // handleSelection run from Pig's stored callbacks and may fire twice before a
  // re-render (shift-click), so the closure value can be stale.
  const updateSelectionState = useCallback((newState: Partial<SelectionState>) => {
    const updatedState = { ...selectionStateRef.current, ...newState };
    selectionStateRef.current = updatedState;
    setSelectionState(updatedState);
  }, []);

  // Tag the selection from the keyboard, the way Shotwell's Ctrl+T does. A
  // bare "t" rather than a modifier because browsers reserve Ctrl+T for a new
  // tab and a page cannot take it back -- and because the lightbox already
  // binds bare f/h/p/i/z for the same kind of action. Mantine's useHotkeys
  // ignores INPUT/TEXTAREA/SELECT, so this never fires from the search box.
  useHotkeys([
    [
      "t",
      () => {
        const { selectMode, selectAllMode, selectedItems } = selectionStateRef.current;
        if (!isPublic && (selectAllMode || (selectMode && selectedItems.length > 0))) {
          setModalTagOpen(true);
        }
      },
    ],
  ]);

  // Clear any active selection when the media-type filter changes: the set of
  // photos on screen changes, so a carried-over selection (and its "N selected"
  // count or server-side select-all query) would be stale and misleading.
  useEffect(() => {
    const cleared: SelectionState = {
      selectedItems: [],
      selectMode: false,
      selectAllMode: false,
      selectAllQuery: undefined,
      totalCount: undefined,
    };
    selectionStateRef.current = cleared;
    setSelectionState(cleared);
  }, [mediaType]);

  const handleSelection = useCallback(
    (item: any) => {
      const currentState = selectionStateRef.current;

      // In selectAllMode, selectedItems tracks EXCLUDED items
      if (currentState.selectAllMode) {
        const isExcluded = currentState.selectedItems.find(i => i.id === item.id);
        if (isExcluded) {
          // Re-include by removing from exclusions
          updateSelectionState({
            selectedItems: currentState.selectedItems.filter(i => i.id !== item.id),
          });
        } else {
          // Exclude by adding to list
          updateSelectionState({
            selectedItems: [...currentState.selectedItems, item],
          });
        }
        return;
      }

      // Normal selection mode
      let newSelectedItems = currentState.selectedItems;

      if (newSelectedItems.find(selectedItem => selectedItem.id === item.id)) {
        newSelectedItems = newSelectedItems.filter(value => value.id !== item.id);
      } else {
        newSelectedItems = newSelectedItems.concat(item);
      }

      updateSelectionState({
        selectedItems: newSelectedItems,
        selectMode: newSelectedItems.length > 0,
      });
    },
    [updateSelectionState]
  );

  // Shift-click selects the whole range, like a file manager: items already
  // selected stay selected (toggling deselected them), and not-yet-loaded
  // placeholders are skipped. In selectAllMode selectedItems holds the
  // exclusions, so the range is excluded, as a plain click excludes one item.
  const handleSelections = useCallback(
    (items: any[]) => {
      const current = selectionStateRef.current;
      const added = items.filter(
        item => !item.isTemp && !current.selectedItems.some(selectedItem => selectedItem.id === item.id)
      );
      const newSelectedItems = current.selectedItems.concat(added);
      if (current.selectAllMode) {
        updateSelectionState({ selectedItems: newSelectedItems });
        return;
      }
      updateSelectionState({
        selectedItems: newSelectedItems,
        selectMode: newSelectedItems.length > 0,
      });
    },
    [updateSelectionState]
  );

  const getDataForScrollIndicator = (): ScrollerData[] => {
    const scrollPositions: ScrollerData[] = [];
    if (pigRef.current) {
      (pigRef.current.imageData as PigGroupLayout[]).forEach(group => {
        scrollPositions.push({
          label: group.date as string,
          targetY: group.groupTranslateY,
          year: group.year,
          month: group.month,
        });
      });
    }
    return scrollPositions;
  };

  useEffect(() => {
    if (!isLoading && pigRef.current) {
      setDataForScrollIndicator(getDataForScrollIndicator());
      gridHeight.current = pigRef.current.totalHeight;
    }
    // Pig exposes its layout through the imperative handle; re-read it whenever
    // the height it reports on this render differs. getDataForScrollIndicator only
    // reads that ref.
  }, [isLoading, pigRef.current?.totalHeight]);

  const handleClick = useCallback(
    (event: React.MouseEvent<Element, MouseEvent>, item: any) => {
      // if an image is selectable, then handle shift click
      if (selectable && event.shiftKey) {
        const lastSelectedElement = selectionStateRef.current.selectedItems.at(-1);
        if (lastSelectedElement === undefined) {
          handleSelection(item);
          return;
        }
        const indexOfCurrentlySelectedItem = idx2hashRef.current.findIndex(image => image.id === item.id);
        const indexOfLastSelectedItem = idx2hashRef.current.findIndex(image => image.id === lastSelectedElement.id);

        if (indexOfCurrentlySelectedItem > indexOfLastSelectedItem) {
          handleSelections(idx2hashRef.current.slice(indexOfLastSelectedItem + 1, indexOfCurrentlySelectedItem + 1));
          return;
        }
        handleSelections(idx2hashRef.current.slice(indexOfCurrentlySelectedItem, indexOfLastSelectedItem));
        return;
      }
      if (selectionStateRef.current.selectMode) {
        handleSelection(item);
        return;
      }

      // Store image index for later scrolling
      const currentIndex = idx2hashRef.current.findIndex(image => image.id === item.id);
      currentImageIndexRef.current = currentIndex;

      // If Ctrl/Cmd key is pressed, navigate to single photo view
      if (("ctrlKey" in event && event.ctrlKey) || ("metaKey" in event && event.metaKey)) {
        navigate(`/photo/${item.id}`);
        return;
      }

      // Otherwise, open in lightbox
      showLightbox(item.id, currentIndex >= 0);
    },
    [selectable, handleSelection, handleSelections, navigate, showLightbox]
  );

  // In selectAllMode, all real (non-temp) items are selected except the
  // exclusions tracked in selectedItems. Memoised so Pig's selection prop keeps
  // its identity across unrelated re-renders.
  const pigSelectedItems = useMemo(
    () =>
      selectionState.selectAllMode
        ? idx2hash.filter(
            item => !item.isTemp && !selectionState.selectedItems.find(excluded => excluded.id === item.id)
          )
        : selectionState.selectedItems,
    [idx2hash, selectionState.selectAllMode, selectionState.selectedItems]
  );

  // Use live prop length so UI reflects data availability immediately on load
  const getNumPhotos = () => (idx2hash ? idx2hash.length : 0);
  const isUserAlbum = location.pathname.startsWith("/album/user/");

  return (
    <RemoveScroll enabled={lightboxOpen}>
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
            {!isLoading && !isPublic && (getNumPhotos() > 0 || mediaType !== undefined) && (
              <Box ml="auto">
                <Group gap="xs" wrap="nowrap">
                  {/* The media-type filter stays visible even when the current
                      filter yields no photos, so the user is never trapped. */}
                  {mediaType !== undefined && <MediaTypeSelector />}
                  {getNumPhotos() > 0 && isAlbumPubliclyShared && isUserAlbum && (
                    <Tooltip label={t("sidemenu.sharing")} position="bottom">
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="lg"
                        aria-label={t("sidemenu.sharing")}
                        onClick={() => setModalAlbumShareOpen(true)}
                        style={{
                          backgroundColor: "rgba(128, 128, 128, 0.3)",
                          borderRadius: theme.radius.sm,
                        }}
                      >
                        <IconLink size={20} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  {getNumPhotos() > 0 && (
                    <Menu
                      shadow="md"
                      width={240}
                      position="bottom-end"
                      opened={displayMenuOpened}
                      onChange={setDisplayMenuOpened}
                    >
                      <Menu.Target>
                        {/* Hidden while the menu is open: it would sit over the menu's first label. */}
                        <Tooltip label={t("photodisplay.settings")} position="bottom" disabled={displayMenuOpened}>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            aria-label={t("photodisplay.settings")}
                            style={{
                              backgroundColor: colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0],
                              borderRadius: theme.radius.sm,
                            }}
                          >
                            <IconSettings size={20} />
                          </ActionIcon>
                        </Tooltip>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Label>{t("photodisplay.photoSize")}</Menu.Label>
                        <Box p="xs">
                          <Stack gap={6}>
                            <Slider
                              mb={20}
                              value={localImageScale}
                              onChange={handleThumbnailSizeChange}
                              min={0.25}
                              max={3}
                              step={0.05}
                              marks={[
                                { value: 0.5, label: "0.5" },
                                { value: 1, label: "1" },
                                { value: 2, label: "2" },
                              ]}
                            />
                            <Text size="xs" c="dimmed">
                              {t("photodisplay.lowerBigger")}
                            </Text>
                            <Text size="xs" fw={500}>
                              {t("photodisplay.current", { value: localImageScale.toFixed(2) })}
                            </Text>
                          </Stack>
                        </Box>

                        <Menu.Divider />

                        <Menu.Label>{t("photodisplay.textAlignment")}</Menu.Label>
                        <Box p="xs">
                          <Switch
                            label={t("photodisplay.leftAlign")}
                            checked={localTextAlignment === "left"}
                            onChange={event =>
                              handleTextAlignmentChange(event.currentTarget.checked ? "left" : "right")
                            }
                            size="sm"
                          />
                        </Box>

                        <Menu.Divider />

                        <Menu.Label>{t("photodisplay.headerSize")}</Menu.Label>
                        <Box p="xs">
                          <SegmentedControl
                            size="xs"
                            fullWidth
                            value={localHeaderSize}
                            onChange={value => handleHeaderSizeChange(value as HeaderSize)}
                            data={[
                              { value: "large", label: t("photodisplay.large") },
                              { value: "normal", label: t("photodisplay.normal") },
                              { value: "small", label: t("photodisplay.small") },
                            ]}
                          />
                        </Box>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>
              </Box>
            )}
          </Group>
        )}
        {!isLoading && !isPublic && getNumPhotos() > 0 && (
          <Box
            style={{
              padding: 4,
              backgroundColor: colorScheme === "dark" ? theme.colors.dark[7] : theme.colors.gray[2],
              textAlign: "center",
              cursor: "pointer",
              borderRadius: 10,
            }}
          >
            <Group
              style={{
                paddingLeft: 10,
              }}
              justify="space-between"
            >
              <SelectionBar
                selectMode={selectionState.selectMode}
                selectAllMode={selectionState.selectAllMode}
                selectedItems={selectionState.selectedItems}
                idx2hash={idx2hash}
                updateSelectionState={updateSelectionState}
                photosetQuery={photosetQuery}
                totalCount={selectionState.totalCount || numberOfItems || idx2hash.length}
              />
              <Group justify="flex-end">
                {!location.pathname.startsWith("/deleted") && (
                  <SelectionActions
                    selectedItems={selectionState.selectedItems}
                    selectAllMode={selectionState.selectAllMode}
                    selectAllQuery={selectionState.selectAllQuery}
                    totalCount={selectionState.totalCount || numberOfItems || idx2hash.length}
                    albumID={albumID}
                    ownerUsername={ownerUsername}
                    title={title}
                    setAlbumCover={(actionType, photoId) => {
                      // If photoId is provided (from modal), use it directly
                      if (photoId) {
                        if (actionType === "person") {
                          setPersonAlbumCover.mutate({
                            id: `${albumID}`,
                            cover_photo: photoId,
                          });
                        }
                        if (actionType === "useralbum") {
                          setUserAlbumCover.mutate({
                            id: `${albumID}`,
                            photo: photoId,
                          });
                        }
                        return;
                      }

                      // If exactly 1 item selected, use it
                      if (selectionState.selectedItems.length === 1) {
                        if (actionType === "person") {
                          setPersonAlbumCover.mutate({
                            id: `${albumID}`,
                            cover_photo: selectionState.selectedItems[0].image_hash,
                          });
                        }
                        if (actionType === "useralbum") {
                          setUserAlbumCover.mutate({
                            id: `${albumID}`,
                            photo: selectionState.selectedItems[0].id,
                          });
                        }
                      } else if (selectionState.selectedItems.length === 0) {
                        // No selection - open modal picker
                        setCoverPickerAlbumType(actionType as "person" | "useralbum");
                        setModalCoverPickerOpen(true);
                      }
                      // Multiple selected: action is disabled at menu level
                    }}
                    onSharePhotos={() => setModalSharePhotosOpen(true)}
                    onShareAlbum={() => setModalAlbumShareOpen(true)}
                    onAddToAlbum={() => setModalAddToAlbumOpen(true)}
                    onAddTags={() => setModalTagOpen(true)}
                    updateSelectionState={updateSelectionState}
                  />
                )}
                <TrashcanActions
                  selectedItems={selectionState.selectedItems}
                  selectAllMode={selectionState.selectAllMode}
                  selectAllQuery={selectionState.selectAllQuery}
                  totalCount={selectionState.totalCount || numberOfItems || idx2hash.length}
                  updateSelectionState={updateSelectionState}
                />
              </Group>
            </Group>
          </Box>
        )}
      </Box>
      {!isLoading && photos && photos.length > 0 ? (
        <ScrollScrubber
          scrollPositions={dataForScrollIndicator}
          scrollToY={scrollToY}
          targetHeight={gridHeight.current}
          type={ScrollerType.enum.date}
        >
          <Box p={10} ref={gridRef}>
            <Pig
              ref={pigRef}
              className="scrollscrubbertarget"
              imageData={photos}
              selectable={selectable === undefined || selectable}
              selectedItems={pigSelectedItems}
              handleSelection={handleSelection}
              handleClick={handleClick}
              scaleOfImages={localImageScale}
              groupByDate={isDateView}
              getUrl={getUrl}
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

      {lightboxOpen && (
        <Lightbox
          isPublic={isPublic}
          publicAlbumSlug={publicAlbumSlug}
          // type lets public and shared views, which have no photo details, play videos;
          // isTemp marks placeholders that have not loaded yet; date and location feed
          // the details panel a non-owner sees (the server already leaves out what it
          // may not share).
          idx2hash={idx2hash.map(item => ({
            id: item.id,
            image_hash: item.image_hash,
            type: item.type,
            isTemp: item.isTemp,
            date: item.date,
            location: item.location,
          }))}
          selectedImage={lightboxImageId}
          onChangedIndex={handleLightboxIndexChange}
          onCloseRequest={closeLightbox}
          onImageChange={handleLightboxImageChange}
        />
      )}

      {!isPublic && (
        <AlbumEditModal
          isOpen={modalAddToAlbumOpen}
          onRequestClose={() => {
            setModalAddToAlbumOpen(false);
            updateSelectionState({
              selectedItems: [],
              selectMode: false,
              selectAllMode: false,
              selectAllQuery: undefined,
            });
          }}
          selectedImages={selectionState.selectedItems}
          selectAllMode={selectionState.selectAllMode}
          selectAllQuery={selectionState.selectAllQuery}
          totalCount={selectionState.totalCount || numberOfItems || idx2hash.length}
        />
      )}
      {!isPublic && (
        <ModalTagEdit
          isOpen={modalTagOpen}
          onRequestClose={() => {
            setModalTagOpen(false);
            updateSelectionState({
              selectedItems: [],
              selectMode: false,
              selectAllMode: false,
              selectAllQuery: undefined,
            });
          }}
          selectedImages={selectionState.selectedItems}
          selectAllMode={selectionState.selectAllMode}
          selectAllQuery={selectionState.selectAllQuery}
          totalCount={selectionState.totalCount || numberOfItems || idx2hash.length}
        />
      )}
      {!isPublic && (
        <ModalPhotosShare
          isOpen={modalSharePhotosOpen}
          onRequestClose={() => {
            setModalSharePhotosOpen(false);
          }}
          selectedImageHashes={selectionState.selectedItems.map(i => i.image_hash)}
          selectAllMode={selectionState.selectAllMode}
          selectAllQuery={selectionState.selectAllQuery}
        />
      )}
      {!isPublic && isUserAlbum && (
        <ModalAlbumShare
          isOpen={modalAlbumShareOpen}
          onRequestClose={() => {
            setModalAlbumShareOpen(false);
          }}
          albumID={albumID ?? ""}
        />
      )}
      {!isPublic && coverPickerAlbumType && (
        <AlbumCoverPickerModal
          isOpen={modalCoverPickerOpen}
          onRequestClose={() => {
            setModalCoverPickerOpen(false);
            setCoverPickerAlbumType(null);
          }}
          photos={idx2hash}
          albumTitle={title}
          onSelectCover={(photoId: string) => {
            if (coverPickerAlbumType === "person") {
              setPersonAlbumCover.mutate({
                id: `${albumID}`,
                cover_photo: photoId,
              });
            }
            if (coverPickerAlbumType === "useralbum") {
              setUserAlbumCover.mutate({
                id: `${albumID}`,
                photo: photoId,
              });
            }
          }}
        />
      )}
    </RemoveScroll>
  );
}

// Default shallow comparison: a custom comparator that only looked at a few
// props silently dropped changes to title, photoset, header, emptyStateConfig,
// updateGroups, etc. Callers should pass stable (memoised) props.
export const PhotoListView = React.memo(PhotoListViewComponent);
