import { Carousel } from "@mantine/carousel";
import "@mantine/carousel/styles.css";
import { ActionIcon, Box, Group, Modal, Stack } from "@mantine/core";
import { IconX as X, IconZoomIn as ZoomIn, IconZoomOut as ZoomOut } from "@tabler/icons-react";
import { useGesture } from "@use-gesture/react";
import React, { useCallback, useEffect, useState } from "react";
import ReactPlayer from "react-player";

import { serverAddress } from "../../api_client/apiClient";
import { photoDetailsApi } from "../../api_client/photos/photoDetail";
import { useAppDispatch, useAppSelector } from "../../store/store";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";

// Define ContentViewer props
type ContentViewerProps = {
  mainSrc: string;
  nextSrc: string | null;
  prevSrc: string | null;
  type: string;
  onCloseRequest: () => void;
  onMovePrevRequest: () => void;
  onMoveNextRequest: () => void;
  onImageLoad: () => void;
  enableZoom: boolean;
  isPublic: boolean;
};

// Define the ContentViewer component first
export function ContentViewer({
  mainSrc,
  nextSrc = null,
  prevSrc = null,
  type,
  onCloseRequest,
  onMovePrevRequest,
  onMoveNextRequest,
  onImageLoad,
  enableZoom = true,
  isPublic,
}: ContentViewerProps) {
  const [isZoomed, setIsZoomed] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // For dragging the image
  const [lightboxSidebarShow, setLightBoxSidebarShow] = useState(false);
  const [faceLocation, setFaceLocation] = useState<{ top: number; bottom: number; left: number; right: number } | null>(
    null
  );
  const [embla, setEmbla] = useState<Embla | null>(null);

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

  // Setup slide change handler for Embla
  const onSlideChange = () => {
    // Handle the slide change based on which slide is now selected
    if (currentIndex === 0 && prevSrc) {
      onMovePrevRequest();
      // Reset zoom when changing slides
      setIsZoomed(false);
      setScale(1);
      setOffset({ x: 0, y: 0 });
    } else if (currentIndex === 2 && nextSrc) {
      onMoveNextRequest();
      // Reset zoom when changing slides
      setIsZoomed(false);
      setScale(1);
      setOffset({ x: 0, y: 0 });
    }
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
  }, [onImageLoad]);

  const toggleZoom = () => {
    const newZoomState = !isZoomed;
    setIsZoomed(newZoomState);
    setScale(newZoomState ? 2 : 1);
    setOffset({ x: 0, y: 0 });
  };

  const handleDragStart = event => {
    event.preventDefault();
  };

  // Preload images to ensure smoother swiping
  useEffect(() => {
    // Preload main image thumbnails for big view and square thumbnails
    const preloadThumbnail = id => {
      if (!id) return;

      // Preload big thumbnail for lightbox
      const bigImg = new Image();
      bigImg.src = `${serverAddress}/media/thumbnails_big/${id}`;

      // Preload square thumbnail for preview
      const squareImg = new Image();
      squareImg.src = `${serverAddress}/media/square_thumbnails/${id}`;
    };

    // Preload previous, main, and next thumbnails
    preloadThumbnail(prevSrc);
    preloadThumbnail(mainSrc);
    preloadThumbnail(nextSrc);
  }, [prevSrc, mainSrc, nextSrc]);

  // Function to render media content based on type
  const renderMedia = (id: string | undefined, isMainContent: boolean = false) => {
    if (!id) return null;

    // Determine the media type for the current slide
    const currentType = isMainContent ? type : "photo"; // Assuming previews are always photos

    if (currentType === "video") {
      return (
        <ReactPlayer
          url={`${serverAddress}/media/video/${id}`}
          width="100%"
          height="82vh"
          controls={isMainContent}
          playing={isMainContent}
          progressInterval={100}
          style={{
            objectFit: "contain",
            borderRadius: "8px",
            overflow: "hidden",
          }}
        />
      );
    }

    if (currentType === "embedded") {
      return (
        <ReactPlayer
          url={`${serverAddress}/media/embedded_media/${id}`}
          width="100%"
          height="82vh"
          controls={isMainContent}
          playing={isMainContent}
          progressInterval={100}
          style={{
            objectFit: "contain",
            borderRadius: "8px",
            overflow: "hidden",
          }}
        />
      );
    }

    return (
      <div
        style={{
          position: "relative",
          height: "82vh",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
        <div
          {...(isMainContent ? bind() : {})}
          style={{
            position: "relative",
            height: "100%",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "8px",
          }}
        >
          <img
            src={`${serverAddress}/media/thumbnails_big/${id}`}
            alt={isMainContent ? "Main Content" : "Preview"}
            loading="eager"
            onLoad={event => {
              if (isMainContent) {
                const { naturalWidth, naturalHeight } = event.target as HTMLImageElement;
                setImageDimensions({ width: naturalWidth, height: naturalHeight });
                setScale(1);
                setOffset({ x: 0, y: 0 });
                setIsZoomed(false);
              }
            }}
            onDragStart={handleDragStart}
            onDoubleClick={isMainContent ? toggleZoom : undefined}
            style={{
              transition: isMainContent ? "transform 0.15s ease-out" : "none",
              transform: isMainContent ? `translate(${offset.x}px, ${offset.y}px) scale(${scale})` : "none",
              objectFit: "contain",
              height: "100%",
              width: "auto",
              maxWidth: "100%",
              display: "block",
              margin: "auto",
              borderRadius: 8,
              opacity: isMainContent ? 1 : 0.9,
              willChange: isMainContent ? "transform" : "auto", // For smoother animations
              backfaceVisibility: "hidden", // Prevents flickering in some browsers
              WebkitBackfaceVisibility: "hidden",
              WebkitTapHighlightColor: "transparent", // Remove tap highlight on mobile
              boxShadow: isMainContent ? "0 4px 16px rgba(0,0,0,0.1)" : "none",
            }}
          />
        </div>
        {isMainContent && faceLocation && (
          <Box
            style={theme => ({
              position: "absolute",
              border: `2px solid ${theme.colors.gray[4]}`,
              borderRadius: theme.radius.lg,
              ...getRelativePosition(faceLocation),
              boxShadow: theme.shadows.lg,
              pointerEvents: "none", // Ensures this doesn't interfere with gestures
            })}
          />
        )}
      </div>
    );
  };

  return (
    <Modal.Root opened onClose={onCloseRequest} fullScreen>
      <Modal.Overlay blur={5} backgroundOpacity={0.8} />
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
          <Stack style={{ width: `100%`, padding: 16, gap: 0 }}>
            {/* Top toolbar */}
            <Group justify="flex-end" style={{ background: "transparent" }}>
              <Toolbar
                photosDetail={photoDetails[mainSrc]}
                lightboxSidebarShow={lightboxSidebarShow}
                closeSidepanel={() => setLightBoxSidebarShow(!lightboxSidebarShow)}
                isPublic={isPublic}
              />
              {enableZoom && type === "photo" && (
                <div style={{ marginBottom: 5 }}>
                  <ActionIcon variant="subtle" color="gray" onClick={toggleZoom}>
                    {isZoomed ? <ZoomOut /> : <ZoomIn />}
                  </ActionIcon>
                </div>
              )}
              <div style={{ marginBottom: 5 }}>
                <ActionIcon variant="subtle" color="gray" onClick={onCloseRequest}>
                  <X />
                </ActionIcon>
              </div>
            </Group>

            {/* Main photo/video with swipe navigation */}
            <div style={{ flex: 1 }}>
              <Carousel getEmblaApi={setEmbla}>
                {/* Previous slide */}
                <Carousel.Slide>{renderMedia(prevSrc, true)}</Carousel.Slide>

                {/* Current slide */}
                <Carousel.Slide>{renderMedia(mainSrc, true)}</Carousel.Slide>

                {/* Next slide */}
                <Carousel.Slide>{renderMedia(nextSrc, true)}</Carousel.Slide>
              </Carousel>
            </div>

            {/* Bottom preview thumbnails */}
            <div
              style={{
                height: "80px",
                marginTop: "12px",
                overflow: "visible",
                position: "absolute",
                bottom: "16px",
                left: "0",
                right: "0",
                zIndex: 100,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                backdropFilter: "blur(5px)",
                WebkitBackdropFilter: "blur(5px)",
                background: "rgba(0,0,0,0.2)",
                padding: "8px 0",
                borderRadius: "8px",
                boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
                margin: "0 auto",
                width: "fit-content",
                minWidth: "240px",
                maxWidth: "90%",
              }}
            >
              <Group justify="center" align="center" style={{ height: "100%" }}>
                {prevSrc && (
                  <Box
                    style={{
                      height: "64px",
                      width: "64px",
                      cursor: "pointer",
                      border: "2px solid rgba(255,255,255,0.6)",
                      borderRadius: "8px",
                      overflow: "hidden",
                      opacity: 0.85,
                      transition: "all 0.2s ease",
                      backgroundColor: "rgba(0,0,0,0.3)",
                      transform: "scale(0.85) translateX(10px)",
                      boxShadow: "0 2px 5px rgba(0,0,0,0.3)",
                    }}
                    onClick={onMovePrevRequest}
                    onMouseOver={e => {
                      e.currentTarget.style.opacity = "1";
                      e.currentTarget.style.transform = "scale(0.9) translateX(10px)";
                      e.currentTarget.style.boxShadow = "0 4px 8px rgba(0,0,0,0.4)";
                    }}
                    onMouseOut={e => {
                      e.currentTarget.style.opacity = "0.85";
                      e.currentTarget.style.transform = "scale(0.85) translateX(10px)";
                      e.currentTarget.style.boxShadow = "0 2px 5px rgba(0,0,0,0.3)";
                    }}
                  >
                    <img
                      src={`${serverAddress}/media/square_thumbnails/${prevSrc}`}
                      alt="Previous"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        pointerEvents: "none",
                      }}
                      loading="eager"
                    />
                  </Box>
                )}

                <Box
                  style={{
                    height: "72px",
                    width: "72px",
                    border: "3px solid #fff",
                    borderRadius: "8px",
                    overflow: "hidden",
                    marginLeft: "8px",
                    marginRight: "8px",
                    boxShadow: "0 0 12px rgba(255,255,255,0.3), 0 4px 8px rgba(0,0,0,0.5)",
                    backgroundColor: "rgba(0,0,0,0.3)",
                    zIndex: 1,
                  }}
                >
                  <img
                    src={`${serverAddress}/media/square_thumbnails/${mainSrc}`}
                    alt="Current"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      pointerEvents: "none",
                    }}
                    loading="eager"
                  />
                </Box>

                {nextSrc && (
                  <Box
                    style={{
                      height: "64px",
                      width: "64px",
                      cursor: "pointer",
                      border: "2px solid rgba(255,255,255,0.6)",
                      borderRadius: "8px",
                      overflow: "hidden",
                      opacity: 0.85,
                      transition: "all 0.2s ease",
                      backgroundColor: "rgba(0,0,0,0.3)",
                      transform: "scale(0.85) translateX(-10px)",
                      boxShadow: "0 2px 5px rgba(0,0,0,0.3)",
                    }}
                    onClick={onMoveNextRequest}
                    onMouseOver={e => {
                      e.currentTarget.style.opacity = "1";
                      e.currentTarget.style.transform = "scale(0.9) translateX(-10px)";
                      e.currentTarget.style.boxShadow = "0 4px 8px rgba(0,0,0,0.4)";
                    }}
                    onMouseOut={e => {
                      e.currentTarget.style.opacity = "0.85";
                      e.currentTarget.style.transform = "scale(0.85) translateX(-10px)";
                      e.currentTarget.style.boxShadow = "0 2px 5px rgba(0,0,0,0.3)";
                    }}
                  >
                    <img
                      src={`${serverAddress}/media/square_thumbnails/${nextSrc}`}
                      alt="Next"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        pointerEvents: "none",
                      }}
                      loading="eager"
                    />
                  </Box>
                )}
              </Group>
            </div>
          </Stack>

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
}

// Now define the LightBox component which uses ContentViewer
export function LightBox(props: LightBoxProps) {
  const { photoDetails } = useAppSelector(store => store.photoDetails);

  const { idx2hash, isPublic, onCloseRequest, selectedImage } = props;
  const [lightboxImageId, setLightboxImageId] = useState(selectedImage);

  const [lightboxImageIndex, setLightboxImageIndex] = useState(
    idx2hash.findIndex(image => image.id === lightboxImageId)
  );

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

export default ContentViewer;
