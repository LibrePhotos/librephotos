import {
  fetchNoTimestampPhotoPaginated,
  fetchNoTimestampPhotoCount,
} from "../../actions/photosActions";
import throttle from "lodash";
import React, { useEffect } from "react";
import _ from "lodash";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { PhotosetType, PhotosState } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../hooks";

export const NoTimestampPhotosView = () => {
  const { fetchedPhotosetType, numberOfPhotos, photosFlat } = useAppSelector((state) => state.photos as PhotosState);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.NO_TIMESTAMP) {
      fetchNoTimestampPhotoCount(dispatch);
      fetchNoTimestampPhotoPaginated(dispatch, 1);
    }
  }, [dispatch]); // Only run on first render

  const getImages = (visibleItems: any) => {
    if (
      visibleItems.filter((i: any) => i.isTemp && i.isTemp != undefined).length > 0
    ) {
      var firstTempObject = visibleItems.filter((i: any) => i.isTemp)[0];
      if (Math.ceil((parseInt(firstTempObject.id) + 1) / 100) != 0) {
          fetchNoTimestampPhotoPaginated( dispatch, 
            Math.ceil(((parseInt(firstTempObject.id) + 1) / 100))
          )
      }
    }
  };

  return (
      <PhotoListView
        title={"Photos without Timestamps"}
        loading={fetchedPhotosetType !== PhotosetType.NO_TIMESTAMP}
        titleIconName={"images outline"}
        isDateView={false}
        photoset={photosFlat}
        idx2hash={photosFlat}
        numberOfItems={numberOfPhotos}
        updateItems={(visibleItems: any) => {
          console.log(visibleItems);
          throttle((getImages(visibleItems), 500));
        }}
        selectable={true}
      />
  
  );
}