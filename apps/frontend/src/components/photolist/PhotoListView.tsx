import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  NumberInput,
  RemoveScroll,
  Switch,
  Tooltip,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import { IconSettings } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { throttle } from "lodash";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSetPersonAlbumCoverMutation, useSetUserAlbumCoverMutation } from "../../api_client/albums/hooks";
import { serverAddress } from "../../api_client/apiClient";
import { DatePhotosGroup, PigPhoto } from "../../api_client/photos/types";
import { UserSelfDetailsQueryKeys, useUpdateUserMutation } from "../../api_client/user/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { formatDateForPhotoGroups } from "../../util/util";
import { ModalAlbumEdit } from "../album/ModalAlbumEdit";
import { Lightbox } from "../lightbox/Lightbox";
import Pig from "../react-pig";
import type { PigHandle } from "../react-pig";
import { ScrollScrubber } from "../scrollscrubber/ScrollScrubber";
import { ScrollerType } from "../scrollscrubber/ScrollScrubberTypes.zod";
import type { ScrollerData } from "../scrollscrubber/ScrollScrubberTypes.zod";
import { ModalAlbumShare } from "../sharing/ModalAlbumShare";
import { ModalPhotosShare } from "../sharing/ModalPhotosShare";
import { DefaultHeader } from "./DefaultHeader";
import { FavoritedOverlay } from "./FavoritedOverlay";
import { SelectionActions } from "./SelectionActions";
import { SelectionBar } from "./SelectionBar";
import { TrashcanActions } from "./TrashcanActions";
import { VideoOverlay } from "./VideoOverlay";

const TIMELINE_SCROLL_WIDTH = 0;

export type PhotoGroup = {
  id: string;
  page: number;
  items?: PigPhoto[];
};

type Props = Readonly<{
  title: string;
  loading: boolean;
  icon: any;
  photoset: any[];
  idx2hash: any[];
  selectable: boolean;
  isPublic?: boolean;
  numberOfItems?: number;
  updateGroups?: any;
  updateItems?: any;
  date?: any;
  dayHeaderPrefix?: any;
  header?: any;
  additionalSubHeader?: any;
  albumID?: string;
  ownerUsername?: string;
}>;

type SelectionState = {
  selectedItems: any[];
  selectMode: boolean;
};

function PhotoListViewComponent({
  title = "",
  loading = true,
  icon = null,
  photoset = [],
  idx2hash = [],
  selectable = false,
  isPublic = false,
  numberOfItems = 0,
  updateGroups = null,
  updateItems = null,
  date = null,
  dayHeaderPrefix = null,
  header = null,
  additionalSubHeader = null,
  albumID,
  ownerUsername,
}: Props) {
  const { height } = useViewportSize();
  const pigRef = useRef<PigHandle>(null);
  const [modalAddToAlbumOpen, setModalAddToAlbumOpen] = useState(false);
  const [modalSharePhotosOpen, setModalSharePhotosOpen] = useState(false);
  const [modalAlbumShareOpen, setModalAlbumShareOpen] = useState(false);
  const [selectionState, setSelectionState] = useState<SelectionState>({ selectedItems: [], selectMode: false });
  const selectionStateRef = useRef(selectionState);
  const [dataForScrollIndicator, setDataForScrollIndicator] = useState<ScrollerData[]>([]);
  const gridHeight = useRef(200);
  const setUserAlbumCover = useSetUserAlbumCoverMutation();
  const setPersonAlbumCover = useSetPersonAlbumCoverMutation();
  const updateUser = useUpdateUserMutation();
  const queryClient = useQueryClient();
  const location = useLocation();
  const { data: userSelfDetails, isLoading: userDetailsLoading } = useCurrentUserSelfDetailsQuery();

  // Combined loading state - wait for both parent loading and user details
  const isLoading = loading || userDetailsLoading;

  // Use query data directly instead of local state
  const imageScale = userSelfDetails?.image_scale ?? 1;
  const textAlignment = (userSelfDetails?.text_alignment as "left" | "right") ?? "right";
  const headerSize = (userSelfDetails?.header_size as "large" | "normal" | "small") ?? "large";

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
            const currentImageId = currentImage.id;

            // Try to find by checking img contents
            let targetButton: Element | null =
              Array.from(buttons).find(btn => {
                const imgs = btn.querySelectorAll("img");
                return Array.from(imgs).some(img => img.src.includes(currentImageId));
              }) || null;

            // If no button found, try another approach - get index position
            if (!targetButton && buttons.length > 0) {
              // If there are the same number of buttons as images, use index directly
              if (buttons.length >= currentImageIndexRef.current) {
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

  const handleThumbnailSizeChange = (value: number | string) => {
    // Save to server
    if (userSelfDetails?.id) {
      const newUserDetails = { ...userSelfDetails, image_scale: typeof value === "number" ? value : parseFloat(value) };
      updateUser.mutate(newUserDetails, {
        onSuccess: () => {
          // Invalidate the user self details query to refetch the latest data
          queryClient.invalidateQueries({ queryKey: UserSelfDetailsQueryKeys });
        },
      });
    }
  };

  const handleTextAlignmentChange = (alignment: "left" | "right") => {
    // Save to server
    if (userSelfDetails?.id) {
      const newUserDetails = { ...userSelfDetails, text_alignment: alignment };
      updateUser.mutate(newUserDetails, {
        onSuccess: () => {
          // Invalidate the user self details query to refetch the latest data
          queryClient.invalidateQueries({ queryKey: UserSelfDetailsQueryKeys });
        },
      });
    }
  };

  const handleHeaderSizeChange = (size: "large" | "normal" | "small") => {
    // Save to server
    if (userSelfDetails?.id) {
      const newUserDetails = { ...userSelfDetails, header_size: size };
      updateUser.mutate(newUserDetails, {
        onSuccess: () => {
          // Invalidate the user self details query to refetch the latest data
          queryClient.invalidateQueries({ queryKey: UserSelfDetailsQueryKeys });
        },
      });
    }
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

  const updateSelectionState = (newState: { selectedItems: any[]; selectMode: boolean }) => {
    const updatedState = { ...selectionState, ...newState };
    selectionStateRef.current = updatedState;
    setSelectionState(updatedState);
  };

  const handleSelection = (item: any) => {
    let newSelectedItems = selectionStateRef.current.selectedItems;

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
                <Menu shadow="md" width={200} position="bottom-end">
                  <Menu.Target>
                    <Tooltip label="Photo Display Settings" position="bottom">
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="lg"
                        aria-label="Settings"
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
                    <Menu.Label>Photo Size</Menu.Label>
                    <Box p="xs">
                      <NumberInput
                        value={imageScale}
                        onChange={handleThumbnailSizeChange}
                        min={0.25}
                        max={3}
                        step={0.05}
                        description="Lower = bigger thumbnails"
                        allowDecimal
                        hideControls={false}
                      />
                    </Box>

                    <Menu.Divider />

                    <Menu.Label>Text Alignment</Menu.Label>
                    <Box p="xs">
                      <Switch
                        label="Left align date & location"
                        checked={textAlignment === "left"}
                        onChange={event => handleTextAlignmentChange(event.currentTarget.checked ? "left" : "right")}
                        size="sm"
                      />
                    </Box>

                    <Menu.Divider />

                    <Menu.Label>Header Size</Menu.Label>
                    <Box p="xs">
                      <Group>
                        <Button
                          size="xs"
                          variant={headerSize === "large" ? "filled" : "outline"}
                          onClick={() => handleHeaderSizeChange("large")}
                        >
                          Large
                        </Button>
                        <Button
                          size="xs"
                          variant={headerSize === "normal" ? "filled" : "outline"}
                          onClick={() => handleHeaderSizeChange("normal")}
                        >
                          Normal
                        </Button>
                        <Button
                          size="xs"
                          variant={headerSize === "small" ? "filled" : "outline"}
                          onClick={() => handleHeaderSizeChange("small")}
                        >
                          Small
                        </Button>
                      </Group>
                    </Box>
                  </Menu.Dropdown>
                </Menu>
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
                selectedItems={selectionState.selectedItems}
                idx2hash={idx2hash}
                updateSelectionState={updateSelectionState}
              />
              <Group justify="flex-end">
                {!location.pathname.startsWith("/deleted") && (
                  <SelectionActions
                    selectedItems={selectionState.selectedItems}
                    // @ts-ignore
                    albumID={params ? params.albumID : undefined}
                    ownerUsername={ownerUsername}
                    title={title}
                    setAlbumCover={actionType => {
                      if (actionType === "person") {
                        setPersonAlbumCover.mutate({
                          id: `${params.albumID}`,
                          cover_photo: selectionState.selectedItems[0].id,
                        });
                      }
                      if (actionType === "useralbum") {
                        setUserAlbumCover.mutate({
                          id: `${params.albumID}`,
                          photo: selectionState.selectedItems[0].id,
                        });
                      }
                    }}
                    onSharePhotos={() => setModalSharePhotosOpen(true)}
                    onShareAlbum={() => setModalAlbumShareOpen(true)}
                    onAddToAlbum={() => setModalAddToAlbumOpen(true)}
                    updateSelectionState={updateSelectionState}
                  />
                )}
                <TrashcanActions
                  selectedItems={selectionState.selectedItems}
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
              selectedItems={selectionStateRef.current.selectedItems}
              handleSelection={handleSelection}
              handleClick={handleClick}
              scaleOfImages={imageScale}
              groupByDate={isDateView}
              getUrl={getUrl}
              toprightoverlay={FavoritedOverlay}
              bottomleftoverlay={VideoOverlay}
              numberOfItems={numberOfItems ?? idx2hashRef.current.length}
              updateItems={updateItems ? throttledUpdateItems : () => {}}
              updateGroups={updateGroups ? throttledUpdateGroups : () => {}}
              bgColor="inherit"
              textAlignment={textAlignment}
              headerSize={headerSize}
            />
          </Box>
        </ScrollScrubber>
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
          idx2hash={idx2hash.map(item => ({ id: item.id }))}
          selectedImage={lightboxImageId}
          onChangedIndex={handleLightboxIndexChange}
          onCloseRequest={closeLightbox}
          onImageChange={handleLightboxImageChange}
        />
      )}

      {!isPublic && (
        <ModalAlbumEdit
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
          selectedImageHashes={selectionState.selectedItems.map(i => i.id)}
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
    </RemoveScroll>
  );
}

export const PhotoListView = React.memo(
  PhotoListViewComponent,
  (prev, next) => prev.loading === next.loading && prev.idx2hash === next.idx2hash
);
