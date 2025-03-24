import { Carousel } from "@mantine/carousel";
import "@mantine/carousel/styles.css";
import { Modal, Stack } from "@mantine/core";
import { useGesture } from "@use-gesture/react";
import React, { useEffect, useState } from "react";

import { useAppSelector } from "../../store/store";
import { FaceOverlay } from "./FaceOverlay";
import { ImagePreloader } from "./ImagePreloader";
import { LightboxControls } from "./LightboxControls";
import { MediaDisplay } from "./MediaDisplay";
import { Sidebar } from "./Sidebar";
import { ThumbnailNavigation } from "./ThumbnailNavigation";
import type { ContentViewerProps, FaceLocationType, ImageDimensions } from "./lightbox.types";

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
  const [faceLocation, setFaceLocation] = useState<FaceLocationType>(null);
  const [embla, setEmbla] = useState<any | null>(null);

  const { photoDetails } = useAppSelector(store => store.photoDetails);
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions>({ width: 0, height: 0 });

  // Setup slide change handler for Embla
  useEffect(() => {
    if (!embla) return;

    const onSlideChange = () => {
      const currentSlide = embla.selectedScrollSnap();
      console.log("Current slide:", currentSlide);

      if (currentSlide === 0 && prevSrc) {
        console.log("Moving to previous slide");
        onMovePrevRequest();
      } else if (currentSlide === 2 && nextSrc) {
        console.log("Moving to next slide");
        onMoveNextRequest();
      }

      // Reset to middle slide to keep the illusion of movement
      embla.scrollTo(1, true);
    };

    embla.on("select", onSlideChange);
    return () => embla.off("select", onSlideChange);
  }, [embla, onMovePrevRequest, onMoveNextRequest]);

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
            {/* Preload images */}
            <ImagePreloader prevSrc={prevSrc} mainSrc={mainSrc} nextSrc={nextSrc} />

            {/* Top toolbar */}
            <LightboxControls
              photoDetail={photoDetails[mainSrc]}
              lightboxSidebarShow={lightboxSidebarShow}
              setLightBoxSidebarShow={setLightBoxSidebarShow}
              isPublic={isPublic}
              enableZoom={enableZoom}
              type={type}
              isZoomed={isZoomed}
              toggleZoom={toggleZoom}
              onCloseRequest={onCloseRequest}
            />

            {/* Main photo/video with swipe navigation */}
            <div style={{ flex: 1 }}>
              <Carousel getEmblaApi={setEmbla} initialSlide={1}>
                {/* Previous slide */}

                <Carousel.Slide>
                  <MediaDisplay
                    id={prevSrc ?? undefined}
                    isMainContent
                    type={type}
                    bind={bind}
                    imageDimensions={imageDimensions}
                    setImageDimensions={setImageDimensions}
                    faceLocation={faceLocation}
                    toggleZoom={toggleZoom}
                    scale={scale}
                    offset={offset}
                    handleDragStart={handleDragStart}
                  />
                </Carousel.Slide>

                {/* Current slide */}
                <Carousel.Slide>
                  <MediaDisplay
                    id={mainSrc}
                    isMainContent
                    type={type}
                    bind={bind}
                    imageDimensions={imageDimensions}
                    setImageDimensions={setImageDimensions}
                    faceLocation={faceLocation}
                    toggleZoom={toggleZoom}
                    scale={scale}
                    offset={offset}
                    handleDragStart={handleDragStart}
                  />
                </Carousel.Slide>

                {/* Next slide */}
                <Carousel.Slide>
                  <MediaDisplay
                    id={nextSrc ?? undefined}
                    isMainContent
                    type={type}
                    bind={bind}
                    imageDimensions={imageDimensions}
                    setImageDimensions={setImageDimensions}
                    faceLocation={faceLocation}
                    toggleZoom={toggleZoom}
                    scale={scale}
                    offset={offset}
                    handleDragStart={handleDragStart}
                  />
                </Carousel.Slide>
              </Carousel>
            </div>

            {/* Bottom preview thumbnails */}
            <ThumbnailNavigation
              prevSrc={prevSrc}
              mainSrc={mainSrc}
              nextSrc={nextSrc}
              onMovePrevRequest={onMovePrevRequest}
              onMoveNextRequest={onMoveNextRequest}
            />
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

export default ContentViewer;
