import { Carousel } from "@mantine/carousel";
import "@mantine/carousel/styles.css";
import { Modal, Stack } from "@mantine/core";
import { useFullscreen, useHotkeys } from "@mantine/hooks";
import { useGesture } from "@use-gesture/react";
import { AnimatePresence, motion } from "motion/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { ImagePreloader } from "./ImagePreloader";
import type { ContentViewerProps, FaceLocationType } from "./lightbox.types";
import { LightboxControls } from "./LightboxControls";
import { MediaDisplay } from "./MediaDisplay";
import { Sidebar } from "./Sidebar";
import { ThumbnailNavigation } from "./ThumbnailNavigation";

export function ContentViewer({
  mainSrc,
  mainSrcHash,
  nextSrc = null,
  nextSrcHash = null,
  prevSrc = null,
  prevSrcHash = null,
  type,
  onCloseRequest,
  onMovePrevRequest,
  onMoveNextRequest,
  enableZoom = true,
  isPublic,
}: ContentViewerProps) {
  const [isZoomed, setIsZoomed] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // For dragging the image
  const [lightboxSidebarShow, setLightBoxSidebarShow] = useState(false);
  const [faceLocation, setFaceLocation] = useState<FaceLocationType>(null);
  const [embla, setEmbla] = useState<any | null>(null);
  const [playing, setPlaying] = useState(true);

  // Slideshow state
  const [isSlideshowActive, setIsSlideshowActive] = useState(false);
  const [localSlideshowInterval, setLocalSlideshowInterval] = useState<number | null>(null);
  const [slideshowProgress, setSlideshowProgress] = useState(0);

  // Fullscreen support
  const contentRef = useRef<HTMLDivElement>(null);
  const { toggle: toggleFullscreen, fullscreen: isFullscreen } = useFullscreen(contentRef);

  // Fetch user settings for default slideshow interval
  const { data: userSelfDetails } = useCurrentUserSelfDetailsQuery();
  const defaultSlideshowInterval = userSelfDetails?.slideshow_interval ?? 5;
  const slideshowInterval = localSlideshowInterval ?? defaultSlideshowInterval;

  // Use image_hash for API calls since backend still uses image_hash for lookup
  const { data: photoDetails, isLoading: isPhotoDetailsLoading } = useFetchPhotoDetailsQuery(mainSrcHash);

  // Reset playing state when slide changes
  useEffect(() => {
    setPlaying(true);
    setSlideshowProgress(0);
  }, [mainSrc]);

  // Slideshow timer and progress for images
  useEffect(() => {
    if (!isSlideshowActive || type === "video" || type === "embedded") {
      setSlideshowProgress(0);
      return;
    }

    // Progress update interval (update every 50ms for smooth animation)
    const progressInterval = 50;
    const totalDuration = slideshowInterval * 1000;
    let elapsed = 0;

    const progressTimer = setInterval(() => {
      elapsed += progressInterval;
      const progress = Math.min((elapsed / totalDuration) * 100, 100);
      setSlideshowProgress(progress);

      if (elapsed >= totalDuration) {
        clearInterval(progressTimer);
        if (nextSrc) {
          onMoveNextRequest();
        } else {
          // Stop slideshow if no more images
          setIsSlideshowActive(false);
        }
      }
    }, progressInterval);

    // eslint-disable-next-line consistent-return
    return () => clearInterval(progressTimer);
  }, [isSlideshowActive, type, mainSrc, slideshowInterval, nextSrc, onMoveNextRequest]);

  // Handle video ended - advance to next if slideshow is active
  const handleVideoEnded = useCallback(() => {
    if (isSlideshowActive && nextSrc) {
      onMoveNextRequest();
    } else if (isSlideshowActive && !nextSrc) {
      // Stop slideshow if no more items
      setIsSlideshowActive(false);
    }
  }, [isSlideshowActive, nextSrc, onMoveNextRequest]);

  // Toggle slideshow function
  const toggleSlideshow = useCallback(() => {
    setIsSlideshowActive(prev => !prev);
  }, []);

  // Setup slide change handler for Embla
  useEffect(() => {
    if (!embla) return;

    const onSlideChange = () => {
      const currentSlide = embla.selectedScrollSnap();

      if (currentSlide === 0 && prevSrc) {
        onMovePrevRequest();
      } else if (currentSlide === 2 && nextSrc) {
        onMoveNextRequest();
      }

      // Reset to middle slide to keep the illusion of movement
      embla.scrollTo(1, true);
    };

    embla.on("select", onSlideChange);
    // eslint-disable-next-line consistent-return
    return () => embla.off("select", onSlideChange);
  }, [embla, onMovePrevRequest, onMoveNextRequest]);

  const toggleZoom = () => {
    const newZoomState = !isZoomed;
    setIsZoomed(newZoomState);
    setScale(newZoomState ? 2 : 1);
    setOffset({ x: 0, y: 0 });
  };

  // Handle close - exit fullscreen first if active
  const handleClose = () => {
    if (isFullscreen) {
      document.exitFullscreen?.();
    }
    onCloseRequest();
  };

  // Add keyboard navigation using Mantine's useHotkeys
  useHotkeys([
    ["ArrowLeft", () => prevSrc && onMovePrevRequest()],
    ["ArrowRight", () => nextSrc && onMoveNextRequest()],
    ["Escape", handleClose],
    [" ", () => type === "video" && setPlaying(prev => !prev)],
    ["z", () => type === "photo" && toggleZoom()],
    ["i", () => setLightBoxSidebarShow(prev => !prev)], // Toggle info panel
    // Additional shortcuts for photo actions (will be implemented in toolbar)
    [
      "f",
      () => {
        // Trigger favorite action if photo details are available and not public
        if (photoDetails && !isPublic) {
          // We'll trigger this via a custom event that the Toolbar can listen to
          window.dispatchEvent(new CustomEvent("lightbox-favorite-shortcut"));
        }
      },
    ],
    [
      "h",
      () => {
        // Trigger hide action if photo details are available and not public
        if (photoDetails && !isPublic) {
          window.dispatchEvent(new CustomEvent("lightbox-hide-shortcut"));
        }
      },
    ],
    [
      "p",
      () => {
        // Trigger public action if photo details are available and not public
        if (photoDetails && !isPublic) {
          window.dispatchEvent(new CustomEvent("lightbox-public-shortcut"));
        }
      },
    ],
    [
      "d",
      () => {
        // Trigger delete action if photo details are available and not public
        if (photoDetails && !isPublic) {
          window.dispatchEvent(new CustomEvent("lightbox-delete-shortcut"));
        }
      },
    ],
    ["g", toggleFullscreen], // Toggle fullscreen mode
    ["s", toggleSlideshow], // Toggle slideshow mode
  ]);

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
    if (embla) {
      embla.reInit();
    }
  }, [lightboxSidebarShow, embla]);

  const handleDragStart = event => {
    event.preventDefault();
  };

  return (
    <Modal.Root opened onClose={handleClose} fullScreen>
      <Modal.Overlay blur={5} backgroundOpacity={0.8} />
      <Modal.Content style={{ background: "transparent" }}>
        <Modal.Body
          ref={contentRef}
          style={{
            width: `100vw`,
            height: "100vh",
            display: "flex",
            alignItems: "stretch",
            padding: 0,
            position: "relative", // For absolute positioning
            background: isFullscreen ? "black" : "transparent",
          }}
        >
          <Stack
            w={lightboxSidebarShow ? { base: "100%", md: "calc(100vw - 400px)" } : "100%"}
            style={{
              padding: 16,
              gap: 0,
              position: "relative", // For the thumbnail navigation
              height: "100%",
            }}
          >
            {/* Preload images */}
            <ImagePreloader prevSrc={prevSrcHash} mainSrc={mainSrcHash} nextSrc={nextSrcHash} />

            {/* Top toolbar */}
            <LightboxControls
              isPhotoDetailsLoading={isPhotoDetailsLoading}
              photoDetail={photoDetails}
              lightboxSidebarShow={lightboxSidebarShow}
              setLightBoxSidebarShow={setLightBoxSidebarShow}
              isPublic={isPublic}
              enableZoom={enableZoom}
              type={type}
              isZoomed={isZoomed}
              toggleZoom={toggleZoom}
              onCloseRequest={handleClose}
              playing={playing}
              setPlaying={setPlaying}
              isFullscreen={isFullscreen}
              toggleFullscreen={toggleFullscreen}
              isSlideshowActive={isSlideshowActive}
              toggleSlideshow={toggleSlideshow}
              slideshowInterval={slideshowInterval}
              setSlideshowInterval={setLocalSlideshowInterval}
              slideshowProgress={slideshowProgress}
            />

            {/* Main photo/video with swipe navigation */}
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              <Carousel
                getEmblaApi={setEmbla}
                initialSlide={1}
                style={{ width: "100%", height: "100%" }}
                slideSize="100%"
                slideGap={0}
                orientation="horizontal"
                loop={false}
                draggable={!isZoomed}
                containScroll="trimSnaps"
              >
                {/* Previous slide */}
                <Carousel.Slide>
                  <MediaDisplay
                    id={prevSrc ?? undefined}
                    image_hash={prevSrcHash ?? undefined}
                    type={type}
                    bind={bind}
                    faceLocation={faceLocation}
                    toggleZoom={toggleZoom}
                    scale={scale}
                    offset={offset}
                    handleDragStart={handleDragStart}
                    playing={false}
                  />
                </Carousel.Slide>

                {/* Current slide */}
                <Carousel.Slide>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={mainSrc}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.05 }}
                      transition={{
                        duration: 0.4,
                        ease: [0.4, 0, 0.2, 1],
                      }}
                      style={{
                        width: "100%",
                        height: "100%",
                      }}
                    >
                      <MediaDisplay
                        id={mainSrc}
                        image_hash={mainSrcHash}
                        isMainContent
                        type={type}
                        bind={bind}
                        faceLocation={faceLocation}
                        toggleZoom={toggleZoom}
                        scale={scale}
                        offset={offset}
                        handleDragStart={handleDragStart}
                        playing={playing}
                        onEnded={handleVideoEnded}
                        {...(photoDetails ? { photoDetails } : {})}
                      />
                    </motion.div>
                  </AnimatePresence>
                </Carousel.Slide>

                {/* Next slide */}
                <Carousel.Slide>
                  <MediaDisplay
                    id={nextSrc ?? undefined}
                    image_hash={nextSrcHash ?? undefined}
                    type={type}
                    bind={bind}
                    faceLocation={faceLocation}
                    toggleZoom={toggleZoom}
                    scale={scale}
                    offset={offset}
                    handleDragStart={handleDragStart}
                    playing={false}
                  />
                </Carousel.Slide>
              </Carousel>
            </div>

            {/* Bottom preview thumbnails */}
            <ThumbnailNavigation
              prevSrc={prevSrc}
              prevSrcHash={prevSrcHash}
              mainSrc={mainSrc}
              mainSrcHash={mainSrcHash}
              nextSrc={nextSrc}
              nextSrcHash={nextSrcHash}
              onMovePrevRequest={onMovePrevRequest}
              onMoveNextRequest={onMoveNextRequest}
            />
          </Stack>

          {lightboxSidebarShow && (
            <Sidebar
              id={mainSrcHash}
              closeSidepanel={() => setLightBoxSidebarShow(!lightboxSidebarShow)}
              isPublic={isPublic}
              setFaceLocation={setFaceLocation}
            />
          )}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

export default ContentViewer;
