import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Photo } from "tabler-icons-react";

import { fetchNoTimestampPhotoPaginated } from "../../actions/photosActions";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { PhotosState } from "../../reducers/photosReducer";
import { PhotosetType } from "../../reducers/photosReducer";
import { useAppDispatch, useAppSelector } from "../../store/store";

export function NoTimestampPhotosView() {
  const { fetchedPhotosetType, numberOfPhotos, photosFlat } = useAppSelector(state => state.photos as PhotosState);
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  useEffect(() => {
    if (fetchedPhotosetType !== PhotosetType.NO_TIMESTAMP) {
      fetchNoTimestampPhotoPaginated(dispatch, 1);
    }
  }, [dispatch]); // Only run on first render

  const getImages = (visibleItems: any) => {
    if (visibleItems.filter((i: any) => i.isTemp).length > 0) {
      const firstTempObject = visibleItems.filter((i: any) => i.isTemp)[0];
      const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);
      if (page > 1) {
        fetchNoTimestampPhotoPaginated(dispatch, page);
      }
    }
  };

  return (
    <PhotoListView
      title={t("photos.notimestamp")}
      loading={fetchedPhotosetType !== PhotosetType.NO_TIMESTAMP}
      icon={<Photo size={50} />}
      photoset={photosFlat}
      idx2hash={photosFlat}
      numberOfItems={numberOfPhotos}
      updateItems={getImages}
      selectable
    />
  );
}
