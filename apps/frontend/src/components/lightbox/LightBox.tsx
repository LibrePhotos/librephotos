import { useViewportSize } from "@mantine/hooks";
import React, { useState } from "react";
import Lightbox from "react-image-lightbox";
import "react-image-lightbox/style.css";
import ReactPlayer from "react-player";

import { serverAddress } from "../../api_client/apiClient";
import { useAppSelector } from "../../store/store";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";

type Props = {
  lightboxImageId: any;
  lightboxImageIndex: any;
  idx2hash: any;
  isPublic: boolean;
  onCloseRequest: () => void;
  onMovePrevRequest: () => void;
  onMoveNextRequest: () => void;
  onImageLoad: () => void;
};

export function LightBox(props: Props) {
  const [lightboxSidebarShow, setLightBoxSidebarShow] = useState(false);
  const { photoDetails } = useAppSelector(store => store.photos);
  const { width: viewportWidth } = useViewportSize();
  let LIGHTBOX_SIDEBAR_WIDTH = 320;
  if (viewportWidth < 600) {
    LIGHTBOX_SIDEBAR_WIDTH = viewportWidth;
  }
  const {
    lightboxImageId,
    lightboxImageIndex,
    idx2hash,
    isPublic,
    onCloseRequest,
    onMovePrevRequest,
    onMoveNextRequest,
    onImageLoad,
  } = props;

  const closeSidepanel = () => {
    setLightBoxSidebarShow(!lightboxSidebarShow);
  };

  const getCurrentPhotodetail = () => photoDetails[lightboxImageId];

  const getPreviousId = () => {
    const image = idx2hash.slice((lightboxImageIndex - 1) % idx2hash.length)[0];
    return image ? image.id : undefined;
  };

  const getNextId = () => {
    const image = idx2hash.slice((lightboxImageIndex + 1) % idx2hash.length)[0];
    return image ? image.id : undefined;
  };

  const getPictureUrl = id => `${serverAddress}/media/thumbnails_big/${id}`;

  const getVideoUrl = id => `${serverAddress}/media/video/${id}`;

  const isVideo = () => {
    if (getCurrentPhotodetail() === undefined || getCurrentPhotodetail().video === undefined) {
      return false;
    }
    return getCurrentPhotodetail().video;
  };

  const getVideoComponent = id =>
    isVideo() ? (
      <ReactPlayer width="100%" height="100%" controls playing url={getVideoUrl(id)} progressInterval={100} />
    ) : null;

  function getTransform({ x = 0, y = 0, zoom = 1, width, targetWidth }) {
    var innerWidth = viewportWidth;
    if (document.getElementsByClassName("ril-inner ril__inner")[0]) {
      innerWidth = document.getElementsByClassName("ril-inner ril__inner")[0].clientWidth;
    }

    let nextX = x;
    if (width > innerWidth) {
      nextX += (innerWidth - width) / 2;
    }
    const scaleFactor = zoom * (targetWidth / width);
    return {
      transform: `translate3d(${nextX}px,${y}px,0) scale3d(${scaleFactor},${scaleFactor},1)`,
    };
  }

  // override static function getTransform from react-image-lightbox
  // @ts-ignore
  Lightbox.getTransform = getTransform;

  return (
    <div
      style={{
        pointerEvents: "none",
      }}
    >
      <Lightbox
        // @ts-ignore
        mainSrc={!isVideo() ? getPictureUrl(lightboxImageId) : null}
        nextSrc={!isVideo() ? getPictureUrl(getNextId()) : undefined}
        prevSrc={!isVideo() ? getPictureUrl(getPreviousId()) : undefined}
        mainCustomContent={getVideoComponent(lightboxImageId)}
        nextCustomContent={getVideoComponent(getNextId())}
        prevCustomContent={getVideoComponent(getPreviousId())}
        imageLoadErrorMessage=""
        discourageDownloads={false}
        toolbarButtons={[
          <Toolbar
            photosDetail={photoDetails[lightboxImageId]}
            lightboxSidebarShow={lightboxSidebarShow}
            closeSidepanel={closeSidepanel}
            isPublic={isPublic}
          />,
        ]}
        onCloseRequest={onCloseRequest}
        onAfterOpen={() => {
          onImageLoad();
        }}
        onMovePrevRequest={() => {
          onMovePrevRequest();
        }}
        onMoveNextRequest={() => {
          onMoveNextRequest();
        }}
        reactModalStyle={{
          content: {},
          overlay: {
            width: lightboxSidebarShow ? viewportWidth - LIGHTBOX_SIDEBAR_WIDTH : viewportWidth,
          },
        }}
      />
      {lightboxSidebarShow ? (
        <Sidebar photoDetail={getCurrentPhotodetail()} closeSidepanel={closeSidepanel} isPublic={isPublic} />
      ) : (
        <div />
      )}
    </div>
  );
}
