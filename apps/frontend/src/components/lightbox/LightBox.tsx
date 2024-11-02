import { ActionIcon, Box, Group, Modal } from "@mantine/core";
import {
  IconArrowLeft as ArrowLeft,
  IconArrowRight as ArrowRight,
  IconX as X,
  IconZoomIn as ZoomIn,
  IconZoomOut as ZoomOut,
} from "@tabler/icons-react";
import { useGesture } from "@use-gesture/react";
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
  const { photoDetails } = useAppSelector(store => store.photoDetails);

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

  const getCurrentPhotodetail = () => photoDetails[lightboxImageId];

  const getPreviousId = () => {
    const image = idx2hash.slice((lightboxImageIndex - 1) % idx2hash.length)[0];
    return image ? image.id : undefined;
  };

  const getNextId = () => {
    const image = idx2hash.slice((lightboxImageIndex + 1) % idx2hash.length)[0];
    return image ? image.id : undefined;
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
        onMovePrevRequest={() => {
          onMovePrevRequest();
        }}
        onMoveNextRequest={() => {
          onMoveNextRequest();
        }}
      />
    </div>
  );
}

type ContentViewerProps = {
  mainSrc: string;
  nextSrc?: string;
  prevSrc?: string;
  type: string;
  onCloseRequest: () => void;
  onMovePrevRequest: () => void;
  onMoveNextRequest: () => void;
  onImageLoad: () => void;
  imagePadding?: number;
  clickOutsideToClose?: boolean;
  enableZoom?: boolean;
  isPublic: boolean;
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
  enableZoom = true,
  isPublic,
}) => {
  const [isZoomed, setIsZoomed] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // For dragging the image
  const [lightboxSidebarShow, setLightBoxSidebarShow] = useState(false);
  const [faceLocation, setFaceLocation] = useState<{ top: number; bottom: number; left: number; right: number } | null>(
    null
  );

  // To-Do: Handle loading of photoDetails and propagate to the ContentViewer
  // The issue that occurs is that the react-player errors out when the details is not loaded for a couple of frames
  // In order to fix this, migrate photoDetails to RTKQuery and handle the loading state
  const { photoDetails } = useAppSelector(store => store.photoDetails);

  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });

  const getRelativePosition = position => {
    if (!position || !imageDimensions.width || !imageDimensions.height) return {};

    const top = (position.top / imageDimensions.height) * 100;
    const left = (position.left / imageDimensions.width) * 100;
    const width = ((position.right - position.left) / imageDimensions.width) * 100;
    const height = ((position.bottom - position.top) / imageDimensions.height) * 100;

    return { top: `${top}%`, left: `${left}%`, width: `${width}%`, height: `${height}%` };
  };

  const bind = useGesture({
    onPinch: state => {
      setScale(Math.max(1, Math.min(scale * state.offset[0], 4)));
    },
    onPinchEnd: () => {
      if (scale < 1.5) {
        setScale(1);
      } else {
        setScale(Math.min(scale, 4));
      }
    },
    onDrag: state => {
      if (isZoomed) {
        setOffset({
          x: state.offset[0],
          y: state.offset[1],
        });
      }
    },
  });

  useEffect(() => {
    if (onImageLoad) onImageLoad();
  }, []);

  const toggleZoom = () => {
    setIsZoomed(prev => !prev);
    setScale(isZoomed ? 1 : 2);
    setOffset({ x: 0, y: 0 });
  };

  const handleDragStart = event => {
    event.preventDefault();
  };

  return (
    <Modal.Root opened={true} onClose={onCloseRequest} fullScreen>
      <Modal.Overlay blur={5} opacity={0.8} />
      <Modal.Content style={{ background: "transparent" }}>
        <Modal.Body
          style={{
            width: `100vw`,
            height: "100vh",
            display: "flex",
            alignItems: "stretch",
            padding: 0,
          }}
        >
          <div style={{ width: `100%`, padding: 16 }}>
            <Group position="right" style={{ background: "transparent" }}>
              <Toolbar
                photosDetail={photoDetails[mainSrc]}
                lightboxSidebarShow={lightboxSidebarShow}
                closeSidepanel={() => setLightBoxSidebarShow(!lightboxSidebarShow)}
                isPublic={isPublic}
              />
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
              {type === "video" && mainSrc ? (
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
                  <div
                    {...bind()}
                    style={{
                      position: "relative",
                      height: "92.5vh",
                      overflow: "hidden",
                    }}
                  >
                    <img
                      src={`${serverAddress}/media/thumbnails_big/${mainSrc}`}
                      alt="Lightbox Main Content"
                      onLoad={event => {
                        const { naturalWidth, naturalHeight } = event.target;
                        setImageDimensions({ width: naturalWidth, height: naturalHeight });
                        setScale(1);
                        setOffset({ x: 0, y: 0 });
                        setIsZoomed(false);
                      }}
                      onDragStart={handleDragStart}
                      onDoubleClick={toggleZoom}
                      style={{
                        transition: "transform 0.1s ease",
                        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                        objectFit: "contain",
                        height: "100%",
                        width: "auto",
                        maxWidth: "100%",
                        display: "block",
                        margin: "auto",
                        borderRadius: 16,
                      }}
                    />
                  </div>
                  {faceLocation && (
                    <Box
                      sx={theme => ({
                        position: "absolute",
                        border: `2px solid ${theme.colors.gray[4]}`,
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
          </div>
          {lightboxSidebarShow ? (
            <Sidebar
              id={mainSrc}
              closeSidepanel={() => setLightBoxSidebarShow(!lightboxSidebarShow)}
              isPublic={isPublic}
              setFaceLocation={setFaceLocation}
            />
          ) : (
            <div />
          )}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ContentViewer;
