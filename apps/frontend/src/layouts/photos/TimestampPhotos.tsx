import React, { useEffect } from "react";
import {
  fetchDateAlbumsList,
  fetchAlbumsDateGalleries,
} from "../../actions/albumsActions";
import throttle from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType, PhotosState } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../hooks";

export const TimestampPhotos = () => {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector((state) => state.photos as PhotosState);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.TIMESTAMP) {
      fetchDateAlbumsList(dispatch);
    }
  }, [dispatch]); // Only run on first render

  const getAlbums = (visibleGroups: any) => {
    visibleGroups.forEach((group : any) => {
      if (group.incomplete === true) {
        (fetchAlbumsDateGalleries(dispatch, group.id));
      }
    });
  };

  return (
    <PhotoListView
        title={"Photos"}
        loading={fetchedPhotosetType !== PhotosetType.TIMESTAMP}
        titleIconName={"images"}
        isDateView={true}
        photoset={photosGroupedByDate}
        idx2hash={photosFlat}
        updateGroups={(visibleGroups: any) =>
          throttle((getAlbums(visibleGroups), 500))
        }
        selectable={true}
      />
  );
}