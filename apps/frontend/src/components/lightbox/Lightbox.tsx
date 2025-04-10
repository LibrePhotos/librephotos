import React, { useEffect, useState } from "react";

import { useFetchPhotoDetailsQuery } from "../../api_client/photos/photoDetail";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { ContentViewer } from "./ContentViewer";
import type { LightBoxProps } from "./lightbox.types";

export function Lightbox(props: LightBoxProps) {
  

  const { idx2hash, isPublic, onCloseRequest, selectedImage, onChangedIndex } = props;
  const [lightboxImageId, setLightboxImageId] = useState(selectedImage);

  const [lightboxImageIndex, setLightboxImageIndex] = useState(
    idx2hash.findIndex(image => image.id === lightboxImageId)
  );

  const { data: photoDetails } = useFetchPhotoDetailsQuery(lightboxImageId);

  useEffect(() => {
    onChangedIndex(lightboxImageIndex);
  }, [lightboxImageIndex]);

  const onMovePrevRequest = () => {
    const prevIndex = (lightboxImageIndex + idx2hash.length - 1) % idx2hash.length;
    setLightboxImageIndex(prevIndex);
    setLightboxImageId(idx2hash[prevIndex].id);
  };

  const onMoveNextRequest = () => {
    const nextIndex = (lightboxImageIndex + idx2hash.length + 1) % idx2hash.length;
    setLightboxImageIndex(nextIndex);
    setLightboxImageId(idx2hash[nextIndex].id);
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
    if (photoDetails === undefined) {
      return "photo";
    }
    
    if (photoDetails.video) {
      return "video";
    }
    
    if (photoDetails.embedded_media && photoDetails.embedded_media.length > 0) {
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
        enableZoom={getMediaType() === "photo"}
        onCloseRequest={onCloseRequest}
        onMovePrevRequest={onMovePrevRequest}
        onMoveNextRequest={onMoveNextRequest}
        onImageLoad={() => {}}
      />
    </div>
  );
}

export default Lightbox;
