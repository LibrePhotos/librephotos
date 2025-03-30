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
import { useNavigate, useParams } from "react-router-dom";

import { useSetPersonAlbumCoverMutation } from "../../api_client/albums/people";
import { useSetUserAlbumCoverMutation } from "../../api_client/albums/user";
import { serverAddress } from "../../api_client/apiClient";
import { useUpdateUserMutation } from "../../api_client/user";
import { useAppSelector } from "../../store/store";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { formatDateForPhotoGroups } from "../../util/util";
import { ModalAlbumEdit } from "../album/ModalAlbumEdit";
import { Lightbox } from "../lightbox/Lightbox";
import Pig from "../react-pig";
import { ScrollScrubber } from "../scrollscrubber/ScrollScrubber";
import { ScrollerType } from "../scrollscrubber/ScrollScrubberTypes.zod";
import type { IScrollerData } from "../scrollscrubber/ScrollScrubberTypes.zod";
import { ModalAlbumShare } from "../sharing/ModalAlbumShare";
import { ModalPhotosShare } from "../sharing/ModalPhotosShare";
import { DefaultHeader } from "./DefaultHeader";
import { FavoritedOverlay } from "./FavoritedOverlay";
import { SelectionActions } from "./SelectionActions";
import { SelectionBar } from "./SelectionBar";
import { TrashcanActions } from "./TrashcanActions";
import { VideoOverlay } from "./VideoOverlay";

const TIMELINE_SCROLL_WIDTH = 0;

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

const DEFAULT_PROPS: Props = {
  title: "",
  loading: true,
  icon: null,
  photoset: [],
  idx2hash: [],
  selectable: false,
  isPublic: false,
  numberOfItems: 0,
  updateGroups: null,
  updateItems: null,
  date: null,
  dayHeaderPrefix: null,
  header: null,
  additionalSubHeader: null,
};

function PhotoListViewComponent(props: Props = DEFAULT_PROPS) {
  const { height } = useViewportSize();
  const pigRef = useRef<Pig>(null);
  const [lightboxImageId, setLightboxImageId] = useState("");
  const [modalAddToAlbumOpen, setModalAddToAlbumOpen] = useState(false);
  const [modalSharePhotosOpen, setModalSharePhotosOpen] = useState(false);
  const [modalAlbumShareOpen, setModalAlbumShareOpen] = useState(false);
  const [selectionState, setSelectionState] = useState<SelectionState>({ selectedItems: [], selectMode: false });
  const selectionStateRef = useRef(selectionState);
  const [dataForScrollIndicator, setDataForScrollIndicator] = useState<IScrollerData[]>([]);
  const gridHeight = useRef(200);
  const [scrollLocked, setScrollLocked] = useState(false);
  const [setUserAlbumCover] = useSetUserAlbumCoverMutation();
  const [setPersonAlbumCover] = useSetPersonAlbumCoverMutation();
  const [updateUser] = useUpdateUserMutation();
  const route = useAppSelector(store => store.router);
  const userSelfDetails = useAppSelector(store => store.user.userSelfDetails);
  const [imageScale, setImageScale] = useState(userSelfDetails.image_scale);
  const currentImageIndexRef = useRef(0);
  const navigate = useNavigate();
  const {
    updateGroups,
    title,
    loading,
    icon,
    photoset,
    idx2hash,
    selectable,
    isPublic,
    numberOfItems,
    updateItems,
    date,
    dayHeaderPrefix,
    header,
    additionalSubHeader,
  } = props;

  const isDateView = photoset !== idx2hash;
  const photos = isDateView ? formatDateForPhotoGroups(photoset) : photoset;

  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();
  const idx2hashRef = useRef(idx2hash);
  const params = useParams();

  useEffect(() => {
    idx2hashRef.current = idx2hash;
  }, [idx2hash]);

  useEffect(() => {
    setImageScale(userSelfDetails.image_scale);
  }, [userSelfDetails.image_scale]);

  const handleThumbnailSizeChange = (value: number) => {
    // Update the component state
    setImageScale(value);

    // Save to server
    if (userSelfDetails.id) {
      const newUserDetails = { ...userSelfDetails, image_scale: value };
      updateUser(newUserDetails);
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

  const getUrl = useCallback((url: string, pxHeight: number) => {
    if (pxHeight < 250) {
      return `${serverAddress}/media/square_thumbnails_small/${url.split(";")[0]}`;
    }
    return `${serverAddress}/media/square_thumbnails/${url.split(";")[0]}`;
  }, []);

  const updateSelectionState = (newState: { selectedItems: any[]; selectMode: boolean }) => {
    const updatedState = { ...selectionState, ...newState };
    selectionStateRef.current = updatedState;
    setSelectionState(updatedState);
  };

  const handleSelection = (item: { id: string }) => {
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

  const getDataForScrollIndicator = (): IScrollerData[] => {
    const scrollPositions: IScrollerData[] = [];
    if (pigRef.current) {
      // @ts-ignore
      pigRef.current.imageData.forEach((group: DatePhotosGroupSchema) => {
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

  const handleClick = (event: React.KeyboardEvent, item: { id: string }) => {
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
    if (event.ctrlKey || event.metaKey) {
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
  if (route.location.pathname.startsWith("/useralbum/")) {
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
          textAlign: "center",
          top: 45,
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
                route={route}
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
                      precision={2}
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
                {!route.location.pathname.startsWith("/deleted") && (
                  <SelectionActions
                    selectedItems={selectionState.selectedItems}
                    // @ts-ignore
                    albumID={params ? params.albumID : undefined}
                    title={title}
                    setAlbumCover={actionType => {
                      if (actionType === "person") {
                        setPersonAlbumCover({
                          id: `${params.albumID}`,
                          cover_photo: selectionState.selectedItems[0].id,
                        });
                      }
                      if (actionType === "useralbum") {
                        setUserAlbumCover({
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
          top: TOP_MENU_HEIGHT,
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

                  // Find the button that corresponds to the current image
                  let targetButton = null;

                  // Try to find by checking img contents
                  for (let i = 0; i < buttons.length; i++) {
                    const btn = buttons[i];
                    const imgs = btn.querySelectorAll("img");

                    // Try to match by checking if image source contains the ID
                    if (imgs.length > 0) {
                      for (const img of imgs) {
                        if (img.src.includes(currentImageId)) {
                          targetButton = btn;
                          break;
                        }
                      }
                    }

                    if (targetButton) break;
                  }

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
