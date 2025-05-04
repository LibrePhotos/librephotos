import {
  ActionIcon,
  Box,
  Group,
  Menu,
  NumberInput,
  RemoveScroll,
  Tooltip,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import { IconSettings } from "@tabler/icons-react";
import { throttle } from "lodash";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";

import { useSetPersonAlbumCoverMutation } from "../../api_client/albums/hooks/useSetPersonAlbumCoverMutation";
import { useSetUserAlbumCoverMutation } from "../../api_client/albums/hooks/useSetUserAlbumCoverMutation";
import { useUpdateUserMutation } from "../../api_client/user/hooks";
import { serverAddress } from "../../api_client/apiClient";
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
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { DatePhotosGroup, PigPhoto } from "../../api_client/photos/types";

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
}: Props) {
  const { height } = useViewportSize();
  const pigRef = useRef<PigHandle>(null);
  const [lightboxImageId, setLightboxImageId] = useState("");
  const [modalAddToAlbumOpen, setModalAddToAlbumOpen] = useState(false);
  const [modalSharePhotosOpen, setModalSharePhotosOpen] = useState(false);
  const [modalAlbumShareOpen, setModalAlbumShareOpen] = useState(false);
  const [selectionState, setSelectionState] = useState<SelectionState>({ selectedItems: [], selectMode: false });
  const selectionStateRef = useRef(selectionState);
  const [dataForScrollIndicator, setDataForScrollIndicator] = useState<ScrollerData[]>([]);
  const gridHeight = useRef(200);
  const [scrollLocked, setScrollLocked] = useState(false);
  const setUserAlbumCover = useSetUserAlbumCoverMutation();
  const setPersonAlbumCover = useSetPersonAlbumCoverMutation();
  const updateUser = useUpdateUserMutation();
  const location = useLocation();
  const { data: userSelfDetails } = useCurrentUserSelfDetailsQuery();
  const [imageScale, setImageScale] = useState(userSelfDetails?.image_scale ?? 1);
  const currentImageIndexRef = useRef(0);
  const navigate = useNavigate();

  const isDateView = photoset !== idx2hash;
  const photos = isDateView ? formatDateForPhotoGroups(photoset) : photoset;

  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme('light');
  const idx2hashRef = useRef(idx2hash);
  const params = {} // fix this

  useEffect(() => {
    idx2hashRef.current = idx2hash;
  }, [idx2hash]);

  useEffect(() => {
    if (userSelfDetails) {
      setImageScale(userSelfDetails.image_scale);
    }
  }, [userSelfDetails?.image_scale]);

  const handleThumbnailSizeChange = (value: number | string) => {
    // Update the component state
    setImageScale(typeof value === 'number' ? value : parseFloat(value));

    // Save to server
    if (userSelfDetails?.id) {
      const newUserDetails = { ...userSelfDetails, image_scale: typeof value === 'number' ? value : parseFloat(value) };
      updateUser.mutate(newUserDetails);
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
    const url = typeof item === 'string' ? item : item.url;
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
    if (!loading && pigRef.current) {
      setDataForScrollIndicator(getDataForScrollIndicator());
      // @ts-ignore
      gridHeight.current = pigRef.current.totalHeight;
    }
    // @ts-ignore
  }, [loading, pigRef.current?.totalHeight]);

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
    if ('ctrlKey' in event && event.ctrlKey || 'metaKey' in event && event.metaKey) {
      navigate(`/photo/${item.id}`);
      return;
    }

    // Otherwise, open in lightbox
    setLightboxImageId(item.id);
    setScrollLocked(true);
  };

  const getNumPhotos = () => (idx2hashRef.current ? idx2hashRef.current.length : 0);
  let isUserAlbum = false;

  // @ts-ignore
  if (location.pathname.startsWith("/useralbum/")) {
    isUserAlbum = true;
  }

  return (
    <RemoveScroll enabled={scrollLocked}>
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
          <Group align="flex-start" style={{ width: "100%" }}>
            <Box style={{ flexGrow: 1 }}>
              <DefaultHeader
                // @ts-ignore
                photoList={this}
                loading={loading}
                numPhotosetItems={photos.length || 0}
                numPhotos={getNumPhotos()}
                icon={icon}
                title={title}
                dayHeaderPrefix={dayHeaderPrefix}
                date={date}
                additionalSubHeader={additionalSubHeader}
              />
            </Box>
            {!loading && !isPublic && getNumPhotos() > 0 && (
              <Menu shadow="md" width={200} position="bottom-end">
                <Menu.Target>
                  <Tooltip label="Photo Display Settings" position="bottom">
                    <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Settings" style={{ marginTop: 8 }}>
                      <IconSettings size={24} />
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
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        )}
        {!loading && !isPublic && getNumPhotos() > 0 && (
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
      {!loading && photos && photos.length > 0 ? (
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

      {lightboxImageId && (
        <Lightbox
          isPublic={!!isPublic}
          selectedImage={lightboxImageId}
          idx2hash={idx2hash}
          onChangedIndex={currentIndex => {
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
                  let targetButton: Element | null = Array.from(buttons).find(btn => {
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
                  console.error("Error scrolling to image:", error);
                }
              }, 100);
            }
          }}
          onCloseRequest={() => {
            setLightboxImageId("");
            setScrollLocked(false);
          }}
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
          albumID={params?.albumID ?? ""}
        />
      )}
    </RemoveScroll>
  );
}

export const PhotoListView = React.memo(
  PhotoListViewComponent,
  (prev, next) => prev.loading === next.loading && prev.idx2hash === next.idx2hash
);
