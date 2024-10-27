import { ActionIcon, Box, Group, Image, Modal, Overlay, Text } from "@mantine/core";
import { useViewportSize } from "@mantine/hooks";
import {
  IconArrowLeft as ArrowLeft,
  IconArrowRight as ArrowRight,
  IconX as X,
  IconZoomIn as ZoomIn,
  IconZoomOut as ZoomOut,
} from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";
import ReactPlayer from "react-player";

import { serverAddress } from "../../api_client/apiClient";
import { useAppSelector } from "../../store/store";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";

type Props = Readonly<{
  lightboxImageId: any;
  lightboxImageIndex: any;
  idx2hash: any;
  isPublic: boolean;
  onCloseRequest: () => void;
  onMovePrevRequest: () => void;
  onMoveNextRequest: () => void;
  onImageLoad: () => void;
}>;

export function LightBox(props: Props) {
  const [lightboxSidebarShow, setLightBoxSidebarShow] = useState(false);
  const { photoDetails } = useAppSelector(store => store.photoDetails);
  const { width: viewportWidth } = useViewportSize();
  const [faceLocation, setFaceLocation] = useState<{ top: number; bottom: number; left: number; right: number } | null>(
    null
  );

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

  const isVideo = () => {
    if (getCurrentPhotodetail() === undefined || getCurrentPhotodetail().video === undefined) {
      return false;
    }
    return getCurrentPhotodetail().video;
  };

  const isEmbeddedMedia = () => {
    if (getCurrentPhotodetail() === undefined || getCurrentPhotodetail().embedded_media.length === 0) {
      return false;
    }
    return getCurrentPhotodetail().embedded_media.length > 0;
  };

  return (
    <div>
      <ContentViewer
        mainSrc={lightboxImageId}
        nextSrc={getNextId()}
        prevSrc={getPreviousId()}
        type={isVideo() ? "video" : isEmbeddedMedia() ? "embedded" : "photo"}
        onImageLoad={onImageLoad}
        faceLocation={faceLocation ? faceLocation : undefined}
        toolbarButtons={[
          <Toolbar
            photosDetail={photoDetails[lightboxImageId]}
            lightboxSidebarShow={lightboxSidebarShow}
            closeSidepanel={closeSidepanel}
            isPublic={isPublic}
          />,
        ]}
        enableZoom={!isVideo() && !isEmbeddedMedia()}
        onCloseRequest={onCloseRequest}
        onMovePrevRequest={() => {
          onMovePrevRequest();
        }}
        onMoveNextRequest={() => {
          onMoveNextRequest();
        }}
        sidebarWidth={lightboxSidebarShow ? LIGHTBOX_SIDEBAR_WIDTH : 0}
      />
      {lightboxSidebarShow ? (
        <Sidebar
          id={lightboxImageId}
          closeSidepanel={closeSidepanel}
          isPublic={isPublic}
          setFaceLocation={setFaceLocation}
        />
      ) : (
        <div />
      )}
    </div>
  );
}

type ContentViewerProps = {
  mainSrc: string | null;
  nextSrc?: string;
  prevSrc?: string;
  type: string;
  onCloseRequest: () => void;
  onMovePrevRequest: () => void;
  onMoveNextRequest: () => void;
  onImageLoad: () => void;
  onImageLoadError?: () => void;
  sidebarWidth?: number;
  toolbarButtons?: React.ReactNode[];
  reactModalStyle?: any;
  faceLocation?: { top: number; bottom: number; left: number; right: number };
  reactModalProps?: any;
  imagePadding?: number;
  clickOutsideToClose?: boolean;
  enableZoom?: boolean;
};

export const ContentViewer: React.FC<ContentViewerProps> = ({
  mainSrc,
  nextSrc,
  prevSrc,
  type,
  onCloseRequest,
  onMovePrevRequest,
  onMoveNextRequest,
  onImageLoad,
  onImageLoadError,
  toolbarButtons,
  enableZoom = true,
  sidebarWidth = 0,
  faceLocation,
}) => {
  const [isZoomed, setIsZoomed] = useState(false);
  const [error, setError] = useState(false);

  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });

  const getRelativePosition = position => {
    if (!position || !imageDimensions.width || !imageDimensions.height) return {};

    const top = (position.top / imageDimensions.height) * 100;
    const left = (position.left / imageDimensions.width) * 100;
    const width = ((position.right - position.left) / imageDimensions.width) * 100;
    const height = ((position.bottom - position.top) / imageDimensions.height) * 100;

    return { top: `${top}%`, left: `${left}%`, width: `${width}%`, height: `${height}%` };
  };

  useEffect(() => {
    if (onImageLoad) onImageLoad();
  }, []);

  const handleImageLoad = () => {
    setError(false);
    onImageLoad();
  };

  const handleImageError = () => {
    setError(true);
    if (onImageLoadError) onImageLoadError();
  };

  const toggleZoom = () => {
    setIsZoomed(prev => !prev);
  };
  return (
    <Modal.Root opened={true} onClose={onCloseRequest} fullScreen>
      <Modal.Overlay blur={5} opacity={0.8} />
      <Modal.Content style={{ background: "transparent" }}>
        <Modal.Body
          style={{
            width: `calc(100vw - ${sidebarWidth}px)`,
            height: "100vh",
          }}
        >
          <Group position="right" style={{ background: "transparent" }}>
            {toolbarButtons && toolbarButtons.length > 0 ? toolbarButtons : null}
            {enableZoom && type === "photo" && (
              <div style={{ marginBottom: 10 }}>
                <ActionIcon onClick={toggleZoom}>{isZoomed ? <ZoomOut /> : <ZoomIn />}</ActionIcon>
              </div>
            )}
            <div style={{ marginBottom: 10 }}>
              <ActionIcon onClick={onCloseRequest}>
                <X color="grey" />
              </ActionIcon>
            </div>
          </Group>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            {/* Navigation Button on the Left */}
            <ActionIcon onClick={onMovePrevRequest} disabled={!prevSrc} size="lg" mr="sm">
              <ArrowLeft size={24} />
            </ActionIcon>

            {/* Main Content (Image or Video) */}
            {error ? (
              <Text color="red">{"Error loading image"}</Text>
            ) : type === "video" && mainSrc ? (
              <ReactPlayer
                url={`${serverAddress}/media/video/${mainSrc}`}
                width="100%"
                height="92.5vh"
                controls
                playing
                progressInterval={100}
              />
            ) : type === "embedded" ? (
              <ReactPlayer
                url={`${serverAddress}/media/embedded/${mainSrc}`}
                width="100%"
                height="92.5vh"
                controls
                playing
                progressInterval={100}
              />
            ) : (
              <div style={{ position: "relative", height: "92.5vh" }}>
                <Image
                  src={`${serverAddress}/media/thumbnails_big/${mainSrc}`}
                  alt="Lightbox Main Content"
                  onLoad={event => {
                    const { naturalWidth, naturalHeight } = event.target;
                    setImageDimensions({ width: naturalWidth, height: naturalHeight });
                    handleImageLoad();
                  }}
                  onError={handleImageError}
                  radius="lg"
                  fit="contain"
                  height="92.5vh"
                ></Image>
                {faceLocation && (
                  <Box
                    sx={theme => ({
                      position: "absolute",
                      border: `2px solid ${theme.colors.gray[4]}`, // Use Mantine's red color
                      borderRadius: theme.radius.lg,
                      ...getRelativePosition(faceLocation),
                      boxShadow: theme.shadows.lg,
                    })}
                  />
                )}
              </div>
            )}

            {/* Navigation Button on the Right */}
            <ActionIcon onClick={onMoveNextRequest} disabled={!nextSrc} size="lg" ml="sm">
              <ArrowRight size={24} />
            </ActionIcon>
          </div>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ContentViewer;
