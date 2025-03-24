import React, { useEffect, useState } from "react";

import { photoDetailsApi } from "../../api_client/photos/photoDetail";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { ContentViewer } from "./ContentViewer";
import type { LightBoxProps } from "./lightbox.types";

export function Lightbox(props: LightBoxProps) {
  const { photoDetails } = useAppSelector(store => store.photoDetails);

  const { idx2hash, isPublic, onCloseRequest, selectedImage, onChangedIndex } = props;
  const [lightboxImageId, setLightboxImageId] = useState(selectedImage);

  const [lightboxImageIndex, setLightboxImageIndex] = useState(
    idx2hash.findIndex(image => image.id === lightboxImageId)
  );

  useEffect(() => {
    onChangedIndex(lightboxImageIndex);
  }, [lightboxImageIndex]);

  const dispatch = useAppDispatch();

  const getPhotoDetails = (image: string) => {
    dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(image));
  };

  const onImageLoad = () => {
    getPhotoDetails(idx2hash[lightboxImageIndex].id);
  };

  const getCurrentPhotodetail = () => photoDetails[lightboxImageId];

  const onMovePrevRequest = () => {
    const prevIndex = (lightboxImageIndex + idx2hash.length - 1) % idx2hash.length;
    setLightboxImageIndex(prevIndex);
    setLightboxImageId(idx2hash[prevIndex].id);
    getPhotoDetails(idx2hash[prevIndex].id);
  };

  const onMoveNextRequest = () => {
    const nextIndex = (lightboxImageIndex + idx2hash.length + 1) % idx2hash.length;
    setLightboxImageIndex(nextIndex);
    setLightboxImageId(idx2hash[nextIndex].id);
    getPhotoDetails(idx2hash[nextIndex].id);
  };

  const getPreviousId = () => {
    if (lightboxImageIndex <= 0 || !idx2hash || !idx2hash.length) return null;

    const prevIndex = (lightboxImageIndex - 1 + idx2hash.length) % idx2hash.length;
    const image = idx2hash[prevIndex];

    // Check if image and image.id exist and image.id is a valid string (not just a numeric index)
    if (!image || !image.id || typeof image.id !== "string" || !image.id.length) return null;

    // Additional validation to ensure it's a hash (should contain alphanumeric characters)
    return /^[a-zA-Z0-9-]+$/.test(image.id) ? image.id : null;
  };

  const getNextId = () => {
    if (lightboxImageIndex >= idx2hash.length - 1 || !idx2hash || !idx2hash.length) return null;

    const nextIndex = (lightboxImageIndex + 1) % idx2hash.length;
    const image = idx2hash[nextIndex];

    // Check if image and image.id exist and image.id is a valid string (not just a numeric index)
    if (!image || !image.id || typeof image.id !== "string" || !image.id.length) return null;

    // Additional validation to ensure it's a hash (should contain alphanumeric characters)
    return /^[a-zA-Z0-9-]+$/.test(image.id) ? image.id : null;
  };

  const getMediaType = () => {
    if (
      getCurrentPhotodetail() === undefined ||
      (getCurrentPhotodetail().video === undefined && getCurrentPhotodetail().embedded_media.length === 0)
    ) {
      return "photo";
    }
    if (getCurrentPhotodetail().video) {
      return "video";
    }
    if (getCurrentPhotodetail().embedded_media.length > 0) {
      return "embedded";
    }
    return "photo";
  };

  return (
    <div>
      <ContentViewer
        mainSrc={lightboxImageId}
        nextSrc={getNextId()}
        prevSrc={getPreviousId()}
        isPublic={isPublic}
        type={getMediaType()}
        onImageLoad={onImageLoad}
        enableZoom={getMediaType() === "photo"}
        onCloseRequest={onCloseRequest}
        onMovePrevRequest={onMovePrevRequest}
        onMoveNextRequest={onMoveNextRequest}
      />
    </div>
  );
}

export default Lightbox;
