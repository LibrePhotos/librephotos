import { Box, Group } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import _ from "lodash";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Pig from "react-pig";

import { setAlbumCoverForPerson } from "../../actions/peopleActions";
import { fetchPhotoDetail } from "../../actions/photosActions";
import { serverAddress } from "../../api_client/apiClient";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { TOP_MENU_HEIGHT } from "../../ui-constants";
import { ModalAlbumEdit } from "../album/ModalAlbumEdit";
import { LightBox } from "../lightbox/LightBox";
import { ModalAlbumShare } from "../sharing/ModalAlbumShare";
import { ModalPhotosShare } from "../sharing/ModalPhotosShare";
import { DefaultHeader } from "./DefaultHeader";
import { FavoritedOverlay } from "./FavoritedOverlay";
import { SelectionActions } from "./SelectionActions";
import { SelectionBar } from "./SelectionBar";
import { TrashcanActions } from "./TrashcanActions";
import VideoOverlay from "./VideoOverlay";

const TIMELINE_SCROLL_WIDTH = 0;

type Props = {
  title: string;
  loading: boolean;
  icon: any;
  isDateView: boolean;
  photoset: any[];
  idx2hash: any[];
  selectable: boolean;
  isPublic?: boolean;
  numberOfItems?: number;
  updateGroups?: any;
  updateItems?: any;
  date?: any;
  dayHeaderPrefix?: any;
  match?: any;
  header?: any;
  additionalSubHeader?: any;
};

type SelectionState = {
  selectedItems: any[];
  selectMode: boolean;
};

const PhotoListViewComponent = (props: Props) => {
  const { height } = useViewportSize();

  const [lightboxImageIndex, setLightboxImageIndex] = useState(1);
  const [lightboxImageId, setLightboxImageId] = useState(undefined);
  const [lightboxShow, setLightboxShow] = useState(false);
  const [modalAddToAlbumOpen, setModalAddToAlbumOpen] = useState(false);
  const [modalSharePhotosOpen, setModalSharePhotosOpen] = useState(false);
  const [modalAlbumShareOpen, setModalAlbumShareOpen] = useState(false);
  const [selectionState, setSelectionState] = useState<SelectionState>({ selectedItems: [], selectMode: false });
  const selectionStateRef = useRef(selectionState);

  const route = useAppSelector(store => store.router);
  const userSelfDetails = useAppSelector(store => store.user.userSelfDetails);
  const {
    updateGroups,
    title,
    loading,
    icon,
    isDateView,
    photoset,
    idx2hash,
    selectable,
    isPublic,
    numberOfItems,
    updateItems,
    date,
    dayHeaderPrefix,
    match,
    header,
    additionalSubHeader,
  } = props;

  const idx2hashRef = useRef(idx2hash);
  const dispatch = useAppDispatch();

  console.log("rerendering");

  useEffect(() => {
    idx2hashRef.current = idx2hash;
  }, [idx2hash]);

  const throttledUpdateGroups = useCallback(
    _.throttle(visibleItems => updateGroups(visibleItems), 500),
    []
  );

  const throttledUpdateItems = useCallback(
    _.throttle(visibleItems => updateItems(visibleItems), 500),
    []
  );

  const updateSelectionState = newState => {
    const updatedState = { ...selectionState, ...newState };
    selectionStateRef.current = updatedState;
    setSelectionState(updatedState);
  };

  const handleSelection = item => {
    var newSelectedItems = selectionStateRef.current.selectedItems;
    console.log(selectionStateRef.current.selectedItems);
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

  const handleSelections = items => {
    var newSelectedItems = selectionStateRef.current.selectedItems;
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

  const handleClick = (event, item) => {
    // if an image is selectable, then handle shift click
    if (selectable && event.shiftKey) {
      const lastSelectedElement = selectionStateRef.current.selectedItems.slice(-1)[0];
      if (lastSelectedElement === undefined) {
        handleSelection(item);
        return;
      }
      const indexOfCurrentlySelectedItem = idx2hashRef.current.findIndex(image => image.id === item.id);
      const indexOfLastSelectedItem = idx2hashRef.current.findIndex(image => image.id === lastSelectedElement.id);
      console.log(indexOfCurrentlySelectedItem);
      console.log(indexOfLastSelectedItem);
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

    const lightboxImageIndex = idx2hashRef.current.findIndex(image => image.id === item.id);
    setLightboxImageIndex(lightboxImageIndex);
    setLightboxImageId(item.id);
    setLightboxShow(lightboxImageIndex >= 0);
  };

  const getPhotoDetails = image => {
    dispatch(fetchPhotoDetail(image));
  };

  const closeLightboxIfImageIndexIsOutOfSync = () => {
    if (
      lightboxShow &&
      (idx2hashRef.current.length <= lightboxImageIndex ||
        lightboxImageId !== idx2hashRef.current[lightboxImageIndex].id)
    ) {
      setLightboxShow(false);
    }
  };

  const getNumPhotosetItems = () => {
    return photoset ? photoset.length : 0;
  };

  const getNumPhotos = () => {
    return idx2hashRef.current ? idx2hashRef.current.length : 0;
  };

  const getPigImageData = () => {
    return Array.isArray(photoset) ? photoset : [photoset];
  };
  closeLightboxIfImageIndexIsOutOfSync();

  let isUserAlbum = false;

  // @ts-ignore
  if (route.location.pathname.startsWith("/useralbum/")) {
    isUserAlbum = true;
  }

  return (
    <div>
      <Box
        sx={theme => ({
          backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0],
          textAlign: "center",
          cursor: "pointer",
          position: "sticky",
        })}
        style={{
          width: "100%",
          zIndex: 10,
          boxSizing: "border-box",
          top: 45,
        }}
      >
        {header ? (
          header
        ) : (
          <DefaultHeader
            // @ts-ignore
            route={route}
            photoList={this}
            loading={loading}
            numPhotosetItems={getNumPhotosetItems()}
            numPhotos={getNumPhotos()}
            icon={icon}
            title={title}
            dayHeaderPrefix={dayHeaderPrefix}
            date={date}
            additionalSubHeader={additionalSubHeader}
          />
        )}
        {!loading && !isPublic && getNumPhotos() > 0 && (
          <Box
            sx={theme => ({
              backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[7] : theme.colors.gray[2],
              textAlign: "center",
              cursor: "pointer",
            })}
            style={{
              height: 40,
            }}
          >
            <Group
              style={{
                paddingLeft: 10,
              }}
              position="apart"
            >
              <SelectionBar
                selectMode={selectionState.selectMode}
                selectedItems={selectionState.selectedItems}
                idx2hash={idx2hash}
                updateSelectionState={updateSelectionState}
              />
              <Group position="right">
                {
                  // @ts-ignore
                  !route.location.pathname.startsWith("/deleted") && (
                    <SelectionActions
                      selectedItems={selectionState.selectedItems}
                      albumID={match ? match.params.albumID : undefined}
                      title={title}
                      setAlbumCover={() => {
                        // @ts-ignore
                        dispatch(setAlbumCoverForPerson(match.params.albumID, selectedItems[0].id));
                      }}
                      onSharePhotos={() => setModalSharePhotosOpen(true)}
                      onShareAlbum={() => setModalAlbumShareOpen(true)}
                      onAddToAlbum={() => setModalAddToAlbumOpen(true)}
                      updateSelectionState={updateSelectionState}
                    />
                  )
                }
                <TrashcanActions
                  selectedItems={selectionState.selectedItems}
                  updateSelectionState={updateSelectionState}
                />
              </Group>
            </Group>
          </Box>
        )}
      </Box>
      {!loading && photoset && photoset.length > 0 ? (
        <div>
          <Pig
            imageData={getPigImageData()}
            selectable={selectable === undefined || selectable}
            selectedItems={selectionState.selectedItems}
            handleSelection={handleSelection}
            handleClick={handleClick}
            scaleOfImages={userSelfDetails.image_scale}
            groupByDate={isDateView}
            getUrl={(url, pxHeight) => {
              if (pxHeight < 250) {
                return `${serverAddress}/media/square_thumbnails_small/${url.split(";")[0]}`;
              }
              return `${serverAddress}/media/square_thumbnails/${url.split(";")[0]}`;
            }}
            toprightoverlay={FavoritedOverlay}
            bottomleftoverlay={VideoOverlay}
            numberOfItems={numberOfItems ? numberOfItems : idx2hash.length}
            updateItems={updateItems ? throttledUpdateItems : () => {}}
            updateGroups={updateGroups ? throttledUpdateGroups : () => {}}
            bgColor="inherit"
          />
        </div>
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

      {lightboxShow && (
        <LightBox
          isPublic={isPublic ? true : false}
          idx2hash={idx2hash}
          lightboxImageIndex={lightboxImageIndex}
          lightboxImageId={lightboxImageId}
          onCloseRequest={() => setLightboxShow(false)}
          onImageLoad={() => {
            getPhotoDetails(idx2hash[lightboxImageIndex].id);
          }}
          onMovePrevRequest={() => {
            const prevIndex = (lightboxImageIndex + idx2hash.length - 1) % idx2hash.length;
            setLightboxImageIndex(prevIndex);
            setLightboxImageId(idx2hash[prevIndex].id);
            getPhotoDetails(idx2hash[prevIndex].id);
          }}
          onMoveNextRequest={() => {
            const nextIndex = (lightboxImageIndex + idx2hash.length + 1) % idx2hash.length;
            setLightboxImageIndex(nextIndex);
            setLightboxImageId(idx2hash[nextIndex].id);
            getPhotoDetails(idx2hash[nextIndex].id);
          }}
        />
      )}

      {!isPublic && (
        <ModalAlbumEdit
          isOpen={modalAddToAlbumOpen}
          onRequestClose={() => {
            setModalAddToAlbumOpen(false);
          }}
          selectedImageHashes={selectionState.selectedItems.map(i => i.id)}
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
          match={match}
          // @ts-ignore
          selectedImageHashes={selectedItems.map(i => i.id)}
        />
      )}
    </div>
  );
};

export const PhotoListView = React.memo(PhotoListViewComponent);
