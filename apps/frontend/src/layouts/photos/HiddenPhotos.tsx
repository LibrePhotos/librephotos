import React, { useEffect } from "react";
import { fetchHiddenPhotos } from "../../actions/photosActions";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType, PhotosState } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../hooks";

export const HiddenPhotos = () => {
  const { fetchedPhotosetType, photosFlat, photosGroupedByDate } = useAppSelector((state) => state.photos as PhotosState);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.HIDDEN) {
      fetchHiddenPhotos(dispatch);
    }
  }, [dispatch]); // Only run on first render

  return (
    <PhotoListView
          showHidden={true}
          title={"Hidden Photos"}
          loading={fetchedPhotosetType !== PhotosetType.HIDDEN}
          titleIconName={"hide"}
          isDateView={true}
          photoset={photosGroupedByDate}
          idx2hash={photosFlat}
          selectable={true}
        />
  );
}

