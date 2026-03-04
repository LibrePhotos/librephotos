import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  RemoveScroll,
  Slider,
  Stack,
  Switch,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useDebouncedCallback, useViewportSize } from "@mantine/hooks";
import { IconLink, IconSettings } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { throttle } from "lodash";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import Pig from "../react-pig";
import type { PigHandle } from "../react-pig";
import { ScrollScrubber } from "../scrollscrubber/ScrollScrubber";
import { ScrollerType } from "../scrollscrubber/ScrollScrubberTypes.zod";
import type { ScrollerData } from "../scrollscrubber/ScrollScrubberTypes.zod";
import { ModalAlbumShare } from "../sharing/ModalAlbumShare";
import { ModalPhotosShare } from "../sharing/ModalPhotosShare";
import { DefaultHeader } from "./DefaultHeader";
import { SelectionActions } from "./SelectionActions";
import { SelectionBar } from "./SelectionBar";
import { StackOverlay } from "./StackOverlay";
import { TopRightOverlay } from "./TopRightOverlay";
import { TrashcanActions } from "./TrashcanActions";
import { VideoOverlay } from "./VideoOverlay";

const TIMELINE_SCROLL_WIDTH = 0;

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
}: Props) {
  const { t } = useTranslation();
  const { height } = useViewportSize();
  const pigRef = useRef<PigHandle>(null);
  const [modalAddToAlbumOpen, setModalAddToAlbumOpen] = useState(false);
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
  const setUserAlbumCover = useSetUserAlbumCoverMutation();
  const setPersonAlbumCover = useSetPersonAlbumCoverMutation();
  const updateUser = useUpdateUserMutation();
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
  const headerSize = (userSelfDetails?.header_size as "large" | "normal" | "small") ?? "large";

  const [localImageScale, setLocalImageScale] = useState(imageScale);
  const [localTextAlignment, setLocalTextAlignment] = useState<"left" | "right">(textAlignment);
  const [localHeaderSize, setLocalHeaderSize] = useState<"large" | "normal" | "small">(headerSize);

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
          try {
            // Get all image buttons
            const buttons = document.querySelectorAll(".pig-btn");
            const currentImage = idx2hash[currentImageIndexRef.current];
            // Use image_hash instead of UUID since image URLs use image_hash
            const currentImageHash = currentImage.image_hash || currentImage.url?.split(";")[0];

            // Try to find by checking img contents using image_hash
            let targetButton: Element | null =
              Array.from(buttons).find(btn => {
                const imgs = btn.querySelectorAll("img");
                return Array.from(imgs).some(img => currentImageHash && img.src.includes(currentImageHash));
              }) || null;

            // If no button found, try another approach - get index position
            if (!targetButton && buttons.length > 0) {
              // Use index directly if it's within bounds
              if (currentImageIndexRef.current >= 0 && currentImageIndexRef.current < buttons.length) {
                targetButton = buttons[currentImageIndexRef.current];
              }
            }

            if (targetButton) {
              // Get position
              const rect = targetButton.getBoundingClientRect();
              const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
              const targetY = rect.top + scrollTop - 80; // Offset to show a bit of context

              // Scroll to position
              window.scrollTo({
                top: targetY,
                behavior: "smooth",
              });
            }
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error("Error scrolling to image:", error);
          }
        }, 100);
      }
    },
    [idx2hash]
  );

  const handleLightboxImageChange = useCallback((imageId: string) => {
    setLightboxImageId(imageId);
  }, []);

  const isDateView = photoset !== idx2hash;
  const photos = isDateView ? formatDateForPhotoGroups(photoset) : photoset;

  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme("light");
  const idx2hashRef = useRef(idx2hash);
  const params = { albumID } as { albumID?: string }; // provide album context when available

  useEffect(() => {
    idx2hashRef.current = idx2hash;
  }, [idx2hash]);

  useEffect(() => {
    setLocalImageScale(imageScale);
    setLocalTextAlignment(textAlignment);
    setLocalHeaderSize(headerSize);
  }, [imageScale, textAlignment, headerSize]);

  const debouncedSavePreferences = useDebouncedCallback((partial: Partial<User>) => {
    if (userSelfDetails?.id) {
      const newUserDetails = { ...userSelfDetails, ...partial };
      updateUser.mutate(newUserDetails, {
        context: { silent: true },
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: UserSelfDetailsQueryKeys });
        },
      });
    }
  }, 500);

  const handleThumbnailSizeChange = (value: number) => {
    setLocalImageScale(value);
    debouncedSavePreferences({ image_scale: value });
  };

  const handleTextAlignmentChange = (alignment: "left" | "right") => {
    setLocalTextAlignment(alignment);
    debouncedSavePreferences({ text_alignment: alignment });
  };

  const handleHeaderSizeChange = (size: "large" | "normal" | "small") => {
    setLocalHeaderSize(size);
    debouncedSavePreferences({ header_size: size });
  };

  const throttledUpdateGroups = useCallback(
    throttle(visibleItems => updateGroups(visibleItems), 500),
    []
  );

  const throttledUpdateItems = useCallback(
    throttle(visibleItems => updateItems(visibleItems), 500),
    []
  );

  const getUrl = useCallback((item: any, pxHeight: number) => {
    const url = typeof item === "string" ? item : item.url;
    if (pxHeight < 250) {
      return `${serverAddress}/media/square_thumbnails_small/${url.split(";")[0]}`;
    }
    // Always use the highest quality thumbnails for better image quality
    return `${serverAddress}/media/square_thumbnails/${url.split(";")[0]}`;
  }, []);

  const updateSelectionState = (newState: Partial<SelectionState>) => {
    const updatedState = { ...selectionState, ...newState };
    selectionStateRef.current = updatedState;
    setSelectionState(updatedState);
  };

  const handleSelection = (item: any) => {
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
  };

  const handleSelections = (items: any[]) => {
    let newSelectedItems = selectionStateRef.current.selectedItems;
    items.forEach(item => {
      if (newSelectedItems.find(selectedItem => selectedItem.id === item.id)) {
        newSelectedItems = newSelectedItems.filter(value => value.id !== item.id);
      } else {
        newSelectedItems = newSelectedItems.concat(item);
      }
    });
    updateSelectionState({
      selectedItems: newSelectedItems,
      selectMode: newSelectedItems.length > 0,
    });
  };

  const getDataForScrollIndicator = (): ScrollerData[] => {
    const scrollPositions: ScrollerData[] = [];
    if (pigRef.current) {
      // @ts-ignore
      pigRef.current.imageData.forEach((group: DatePhotosGroup) => {
        scrollPositions.push({
          label: group.date,
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
      // @ts-ignore
      gridHeight.current = pigRef.current.totalHeight;
    }
    // @ts-ignore
  }, [isLoading, pigRef.current?.totalHeight]);

  const scrollToY = (y: number) => {
    window.scrollTo(0, y);
  };

  const handleClick = (event: React.MouseEvent<Element, MouseEvent>, item: any) => {
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
  };

  // Use live prop length so UI reflects data availability immediately on load
  const getNumPhotos = () => (idx2hash ? idx2hash.length : 0);
  let isUserAlbum = false;
  // @ts-ignore
  if (location.pathname.startsWith("/album/user/")) {
    isUserAlbum = true;
  }

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
          <Box style={{ position: "relative", width: "100%" }}>
            <DefaultHeader
              // @ts-ignore
              photoList={this}
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
            />
            {!isLoading && !isPublic && getNumPhotos() > 0 && (
              <Box
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  zIndex: 10,
                }}
              >
                <Group gap="xs">
                  {isAlbumPubliclyShared && isUserAlbum && (
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
                  <Menu shadow="md" width={200} position="bottom-end">
                    <Menu.Target>
                      <Tooltip label={t("photodisplay.settings")} position="bottom">
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
                          onChange={event => handleTextAlignmentChange(event.currentTarget.checked ? "left" : "right")}
                          size="sm"
                        />
                      </Box>

                      <Menu.Divider />

                      <Menu.Label>{t("photodisplay.headerSize")}</Menu.Label>
                      <Box p="xs">
                        <Group>
                          <Button
                            size="xs"
                            variant={localHeaderSize === "large" ? "filled" : "outline"}
                            onClick={() => handleHeaderSizeChange("large")}
                          >
                            {t("photodisplay.large")}
                          </Button>
                          <Button
                            size="xs"
                            variant={localHeaderSize === "normal" ? "filled" : "outline"}
                            onClick={() => handleHeaderSizeChange("normal")}
                          >
                            {t("photodisplay.normal")}
                          </Button>
                          <Button
                            size="xs"
                            variant={localHeaderSize === "small" ? "filled" : "outline"}
                            onClick={() => handleHeaderSizeChange("small")}
                          >
                            {t("photodisplay.small")}
                          </Button>
                        </Group>
                      </Box>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Box>
            )}
          </Box>
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
                    // @ts-ignore
                    albumID={params ? params.albumID : undefined}
                    ownerUsername={ownerUsername}
                    title={title}
                    setAlbumCover={(actionType, photoId) => {
                      // If photoId is provided (from modal), use it directly
                      if (photoId) {
                        if (actionType === "person") {
                          setPersonAlbumCover.mutate({
                            id: `${params.albumID}`,
                            cover_photo: photoId,
                          });
                        }
                        if (actionType === "useralbum") {
                          setUserAlbumCover.mutate({
                            id: `${params.albumID}`,
                            photo: photoId,
                          });
                        }
                        return;
                      }

                      // If exactly 1 item selected, use it
                      if (selectionState.selectedItems.length === 1) {
                        if (actionType === "person") {
                          setPersonAlbumCover.mutate({
                            id: `${params.albumID}`,
                            cover_photo: selectionState.selectedItems[0].image_hash,
                          });
                        }
                        if (actionType === "useralbum") {
                          setUserAlbumCover.mutate({
                            id: `${params.albumID}`,
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
          <Box p={10}>
            <Pig
              ref={pigRef}
              className="scrollscrubbertarget"
              imageData={photos}
              selectable={selectable === undefined || selectable}
              selectedItems={
                selectionState.selectAllMode
                  ? // In selectAllMode, all real (non-temp) items are selected except exclusions
                    idx2hash.filter(
                      item => !item.isTemp && !selectionState.selectedItems.find(excluded => excluded.id === item.id)
                    )
                  : selectionState.selectedItems
              }
              handleSelection={handleSelection}
              handleClick={handleClick}
              scaleOfImages={localImageScale}
              groupByDate={isDateView}
              getUrl={getUrl}
              toprightoverlay={TopRightOverlay}
              bottomleftoverlay={StackOverlay}
              bottomrightoverlay={VideoOverlay}
              numberOfItems={numberOfItems ?? idx2hashRef.current.length}
              updateItems={updateItems ? throttledUpdateItems : () => {}}
              updateGroups={updateGroups ? throttledUpdateGroups : () => {}}
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
          idx2hash={idx2hash.map(item => ({ id: item.id, image_hash: item.image_hash }))}
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
            updateSelectionState({ selectedItems: [], selectMode: false });
          }}
          selectedImages={selectionState.selectedItems}
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
                id: `${params.albumID}`,
                cover_photo: photoId,
              });
            }
            if (coverPickerAlbumType === "useralbum") {
              setUserAlbumCover.mutate({
                id: `${params.albumID}`,
                photo: photoId,
              });
            }
          }}
        />
      )}
    </RemoveScroll>
  );
}

export const PhotoListView = React.memo(
  PhotoListViewComponent,
  (prev, next) => prev.loading === next.loading && prev.idx2hash === next.idx2hash
);
