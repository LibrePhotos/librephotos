import { IconPhoto as Photo } from "@tabler/icons-react";
import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { PigPhoto } from "../../actions/photosActions.types";
import { useFetchPhotosWithoutTimestampQuery } from "../../api_client/photos/list";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import { addTempElementsToFlatList } from "../../util/util";

export function NoTimestampPhotosView() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  // Fetch actual photos
  const { data: photosData, status } = useFetchPhotosWithoutTimestampQuery(page);

  useEffect(() => {
    if (photosData) {
      var tempPhotos = [];

      // If we have a count but no results yet, add temp elements
      if (page === 1) {
        tempPhotos = addTempElementsToFlatList(photosData.count);
      } 
      else {
        tempPhotos = [...photosFlat];
      }
      // If we have results, update the flat list
      if (photosData.results) {
        // a page has 100 photos, so we need to splice the results into the photosFlat
        const index = (page - 1) * 100;
        tempPhotos.splice(index, 100, ...photosData.results);
        setPhotosFlat(tempPhotos);
      }
    }
  }, [photosData]);

  const getImages = (visibleItems: any) => {
    if (visibleItems.filter((i: any) => i.isTemp).length > 0) {
      const firstTempObject = visibleItems.filter((i: any) => i.isTemp)[0];
      const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);
      if (page > 1) {
        setPage(page);
      }
    }
  };

  console.log("photosFlat", photosFlat);

  return (
    <PhotoListView
      title={t("photos.notimestamp")}
      loading={status === "pending"}
      icon={<Photo size={50} />}
      photoset={photosFlat}
      idx2hash={photosFlat}
      numberOfItems={photosFlat?.length}
      updateItems={getImages}
      selectable
    />
  );
}
