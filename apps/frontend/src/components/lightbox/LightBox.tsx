import { useForceUpdate } from "@mantine/hooks";
import React, { useState } from "react";
import Lightbox from "react-image-lightbox";
import "react-image-lightbox/style.css";
import ReactPlayer from "react-player";

import { serverAddress } from "../../api_client/apiClient";
import { useAppSelector } from "../../store/store";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";

let LIGHTBOX_SIDEBAR_WIDTH = 335;
if (window.innerWidth < 600) {
  LIGHTBOX_SIDEBAR_WIDTH = window.innerWidth;
}

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

export const LightBox = (props: Props) => {
  const forceUpdate = useForceUpdate();
  const [lightboxSidebarShow, setLightBoxSidebarShow] = useState(false);
  const { photoDetails } = useAppSelector(store => store.photos);

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
    forceUpdate();
  };

  const getCurrentPhotodetail = () => {
    return photoDetails[lightboxImageId];
  };

  const isLoaded = () => {
    return !photoDetails[lightboxImageId];
  };

  const getPreviousId = () => {
    const image = idx2hash.slice((lightboxImageIndex - 1) % idx2hash.length)[0];
    return image ? image.id : undefined;
  };

  const getNextId = () => {
    const image = idx2hash.slice((lightboxImageIndex + 1) % idx2hash.length)[0];
    return image ? image.id : undefined;
  };

  const getPictureUrl = id => {
    return `${serverAddress}/media/thumbnails_big/${id}`;
  };

  const getVideoUrl = id => {
    return `${serverAddress}/media/video/${id}`;
  };

  const isVideo = () => {
    if (getCurrentPhotodetail() === undefined || getCurrentPhotodetail().video === undefined) {
      return false;
    }
    return getCurrentPhotodetail().video;
  };

  return (
    <div>
      <Lightbox
        // @ts-ignore
        mainSrc={!isVideo() ? getPictureUrl(lightboxImageId) : null}
        nextSrc={getPictureUrl(getNextId())}
        prevSrc={getPictureUrl(getPreviousId())}
        mainCustomContent={
          isVideo() ? (
            <ReactPlayer
              width="100%"
              height="100%"
              controls
              playing
              url={getVideoUrl(lightboxImageId)}
              progressInterval={100}
            />
          ) : null
        }
        imageLoadErrorMessage=""
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
          console.log("lightbox trying to fetch photo detail");
          onImageLoad();
          forceUpdate();
        }}
        onMovePrevRequest={() => {
          onMovePrevRequest();
          forceUpdate();
        }}
        onMoveNextRequest={() => {
          onMoveNextRequest();
          forceUpdate();
        }}
        reactModalStyle={{
          content: {},
          overlay: {
            right: lightboxSidebarShow ? LIGHTBOX_SIDEBAR_WIDTH : 0,
            width: lightboxSidebarShow ? window.innerWidth - LIGHTBOX_SIDEBAR_WIDTH : window.innerWidth,
          },
        }}
      />
      {lightboxSidebarShow ? (
        <Sidebar photoDetail={getCurrentPhotodetail()} closeSidepanel={closeSidepanel} isPublic={isPublic} />
      ) : (
        <div></div>
      )}
    </div>
  );
};
