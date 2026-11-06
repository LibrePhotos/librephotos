import { Carousel, type CarouselProps } from "@mantine/carousel";
import { Modal } from "@mantine/core";
import { useFullscreenDocument, useHotkeys } from "@mantine/hooks";
import { IconChevronLeft as ChevronLeft, IconChevronRight as ChevronRight } from "@tabler/icons-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";
import { useCopyPhotoToClipboard } from "../../hooks/useCopyPhotoToClipboard";
import { ModalPersonEdit } from "../modals/ModalPersonEdit";
import { isPhotoSphere } from "../panorama/photoSphere";
import { usePanoramaMode } from "../panorama/usePanoramaMode";
import classes from "./ContentViewer.module.css";
import { ImagePreloader } from "./ImagePreloader";
import {
  COPY_KEY,
  NEXT_KEY,
  PANORAMA_KEY,
  PLAY_PAUSE_KEY,
  PREVIOUS_KEY,
  SEEK_BACK_KEY,
  SEEK_FORWARD_KEY,
  SEEK_LONG_BACK_KEY,
  SEEK_LONG_FORWARD_KEY,
} from "./lightbox.hotkeys";
import type { ContentViewerProps, FaceLocationType } from "./lightbox.types";
import { createLightboxCommands, LightboxCommandsContext } from "./lightboxCommands";
import { LightboxControls } from "./LightboxControls";
import { liveTextBlocks, mainSlide } from "./lightboxSlide";
import { MediaDisplay } from "./MediaDisplay";
import { photoActionHotkeys } from "./photoActionHotkeys";
import { Sidebar } from "./Sidebar";
import { SlideTransition } from "./SlideTransition";
import { ThumbnailNavigation } from "./ThumbnailNavigation";
import { useAfterTrashToggle } from "./useAfterTrashToggle";
import { useFaceDrawing } from "./useFaceDrawing";
import { useLightboxZoom } from "./useLightboxZoom";
import { usePhotoRotation } from "./usePhotoRotation";
import { useSlideshow } from "./useSlideshow";
import { SEEK_LONG_STEP_SECONDS, SEEK_STEP_SECONDS } from "./videoFailure";
import { ViewerDarkScope } from "./ViewerDarkScope";

/** The Embla carousel API that Mantine's Carousel hands to getEmblaApi. */
type EmblaApi = Parameters<NonNullable<CarouselProps["getEmblaApi"]>>[0];

/**
 * Whether an Escape keypress is the lightbox's to handle. A dialog opened on
 * top of it (naming a face, picking a location, the share link) portals its
 * own `role="dialog"` and closes itself on Escape, and Mantine marks an open
 * menu or combobox the same way it does for its own modals; the lightbox must
 * not close with them.
 */
export function escapeTargetsLightbox(target: EventTarget | null, lightboxDialog: Element | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.getAttribute("data-mantine-stop-propagation") === "true") return false;
  const dialog = target.closest('[role="dialog"]');
  return !dialog || dialog === lightboxDialog;
}

export function ContentViewer({
  mainSrc,
  mainSrcHash,
  nextSrc,
  nextSrcHash,
  prevSrc,
  prevSrcHash,
  type,
  onCloseRequest,
  onMovePrevRequest,
  onMoveNextRequest,
  enableZoom,
  isPublic,
  publicAlbumSlug,
  onPhotoSelect,
  startSlideshow,
  gridItem,
  onTrashToggled,
  toolbarTitle,
}: ContentViewerProps) {
  const [lightboxSidebarShow, setLightBoxSidebarShow] = useState(false);
  const [faceLocation, setFaceLocation] = useState<FaceLocationType>(null);
  const [embla, setEmbla] = useState<EmblaApi | null>(null);
  const [playing, setPlaying] = useState(true);
  // "Live text": overlay selectable OCR text on the photo
  const [showOcrText, setShowOcrText] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  // Fullscreen support. The whole document goes fullscreen, as it always has
  // here: Mantine 8's useFullscreen() took no element (the contentRef this used
  // to be handed was ignored), and useFullscreenDocument is its Mantine 9 successor.
  const { toggle: toggleFullscreen, fullscreen: isFullscreen } = useFullscreenDocument();

  const slideshow = useSlideshow({ startSlideshow, isPublic, type, mainSrc, nextSrc, onMoveNextRequest });

  // Use image_hash for API calls since backend still uses image_hash for lookup
  // Skip this query on public pages since we don't have authenticated access to photo details
  const { data: photoDetails, isLoading: isPhotoDetailsLoading } = useFetchPhotoDetailsQuery(mainSrcHash, isPublic);
  const { mainType } = mainSlide(type, isPublic, isPhotoDetailsLoading);
  const { isZoomed, scale, offset, toggleZoom, isMagnified, bind } = useLightboxZoom(mainSrc);
  const { t } = useTranslation();
  // A photo sphere opens flat; "360° view" (V) shows it in the panorama viewer (#483). A public
  // page has no details, so the grid's entry says whether it is one.
  const panorama = usePanoramaMode({
    sphere: type === "photo" && isPhotoSphere(photoDetails ?? gridItem),
    photoKey: mainSrc,
  });
  // The rotate buttons only show once the details are in.
  const { rotationAngle, imageCacheKey, suppressRotationTransition, rotate, onImageLoad } = usePhotoRotation(
    mainSrcHash,
    mainSrc
  );
  // Marking a face the detector missed; the hover box of a listed face would cover the drawing.
  const clearFaceLocation = useCallback(() => setFaceLocation(null), []);
  const faceDrawing = useFaceDrawing(mainSrcHash, clearFaceLocation);

  // A drawn box is read against the layer's on-screen rect, which stays right
  // through zoom and pan but not through rotation: the rect of a rotated
  // rectangle is its bounding box, so the fractions would not line up.
  const isRotated = rotationAngle % 360 !== 0;
  const addFaceBlockedReason = isRotated ? t("lightbox.addface.rotated") : undefined;

  // Copy to clipboard: the toolbar menu and Ctrl/Cmd+C, for still photos on
  // pages that have an image clipboard at all (secure contexts only).
  const { supported: canCopyToClipboard, copy: copyPhotoToClipboard } = useCopyPhotoToClipboard();
  const canCopyPhoto = canCopyToClipboard && type === "photo";
  const handleCopyPhoto = useCallback(() => {
    if (canCopyPhoto) copyPhotoToClipboard({ imageHash: mainSrcHash, cacheKey: imageCacheKey });
  }, [canCopyPhoto, copyPhotoToClipboard, mainSrcHash, imageCacheKey]);

  // Reset playing state when slide changes
  useEffect(() => {
    setPlaying(true);
    setShowOcrText(false);
  }, [mainSrc]);

  const ocrBlocks = liveTextBlocks(photoDetails, type);
  const hasOcrText = ocrBlocks !== undefined;

  const toggleOcrText = useCallback(() => {
    setShowOcrText(prev => !prev);
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
    return () => {
      embla.off("select", onSlideChange);
    };
    // prevSrc/nextSrc must be deps: the handler decides from them whether a swipe
    // can move at all, and a handler registered on the first photo would otherwise
    // keep seeing "no previous photo" after navigating forward.
  }, [embla, prevSrc, nextSrc, onMovePrevRequest, onMoveNextRequest]);

  // Handle close - exit fullscreen first if active
  const handleClose = () => {
    if (isFullscreen) {
      document.exitFullscreen?.();
    }
    onCloseRequest();
  };

  const handleAfterTrashToggle = useAfterTrashToggle({
    mainSrc,
    mainSrcHash,
    nextSrc,
    prevSrc,
    onMoveNextRequest,
    onMovePrevRequest,
    onClose: handleClose,
    onTrashToggled,
  });

  const handleEscape = (event: KeyboardEvent) => {
    if (!escapeTargetsLightbox(event.target, contentRef.current?.closest('[role="dialog"]') ?? null)) return;
    // Escape leaves the 360° view first, as it gave the arrow keys to looking around.
    if (panorama.active) panorama.exit();
    else handleClose();
  };

  // The shortcuts below that act on the toolbar or the player are commands to them.
  const [commands] = useState(createLightboxCommands);

  // Add keyboard navigation using Mantine's useHotkeys
  useHotkeys([
    // In the 360° view the arrows look around (the viewer's own keys); the buttons still step.
    [PREVIOUS_KEY, () => !panorama.active && prevSrc && onMovePrevRequest()],
    [NEXT_KEY, () => !panorama.active && nextSrc && onMoveNextRequest()],
    // Seeking is added alongside the arrows rather than taking them over. A
    // focused <video> would seek with the bare arrow keys, but these hotkeys
    // are bound on `document` and Mantine's ignore list covers only INPUT,
    // TEXTAREA and SELECT -- so the arrows reach navigation from inside the
    // player too, and whether a key seeks or navigates would otherwise depend
    // on the invisible question of whether the user had clicked the video
    // first. Google Photos and Apple Photos likewise keep the arrows on
    // navigation. Mantine matches modifiers exactly, so these do not fire the
    // two bindings above.
    [SEEK_BACK_KEY, () => commands.emit("seek", -SEEK_STEP_SECONDS)],
    [SEEK_FORWARD_KEY, () => commands.emit("seek", SEEK_STEP_SECONDS)],
    [SEEK_LONG_BACK_KEY, () => commands.emit("seek", -SEEK_LONG_STEP_SECONDS)],
    [SEEK_LONG_FORWARD_KEY, () => commands.emit("seek", SEEK_LONG_STEP_SECONDS)],
    // Mantine's own closeOnEscape is off (see Modal.Root): it listens on the
    // window ahead of everything, so Escape meant for the caption editor, a tag
    // input, the face-drawing layer or a nested dialog closed the lightbox too.
    // This hotkey skips inputs and contenteditable, and the face layer stops it.
    ["Escape", handleEscape],
    [PLAY_PAUSE_KEY, () => type === "video" && setPlaying(prev => !prev)],
    ["z", () => type === "photo" && !panorama.active && toggleZoom()],
    [PANORAMA_KEY, panorama.toggle],
    ["i", () => setLightBoxSidebarShow(prev => !prev)], // Toggle info panel
    // F, 0-5, H, P and D act on the photo through the toolbar.
    ...photoActionHotkeys(commands, !!photoDetails && !isPublic),
    ["g", toggleFullscreen], // Toggle fullscreen mode
    ["s", slideshow.toggleSlideshow], // Toggle slideshow mode
    ["t", () => hasOcrText && toggleOcrText()], // Toggle live text selection
    [
      COPY_KEY,
      (event: KeyboardEvent) => {
        // Selected text (live text, the sidebar) keeps the browser's own copy,
        // which is why preventDefault is deferred until the photo is taken.
        if (!canCopyPhoto || window.getSelection()?.toString()) return;
        event.preventDefault();
        handleCopyPhoto();
      },
      { preventDefault: false },
    ],
  ]);

  // Dragging pans a zoomed photo or turns a sphere instead of swiping to the next one.
  const holdsDrag = isMagnified || panorama.active;

  useEffect(() => {
    if (embla) embla.reInit();
  }, [lightboxSidebarShow, embla]);

  const handleDragStart = (event: React.DragEvent) => {
    event.preventDefault();
  };

  return (
    <LightboxCommandsContext.Provider value={commands}>
      <Modal.Root opened onClose={handleClose} fullScreen closeOnEscape={false}>
        <Modal.Overlay color="var(--mantine-color-black)" backgroundOpacity={1} />
        <Modal.Content bg="transparent">
          <Modal.Body
            ref={contentRef}
            // The focus trap otherwise lands on the first toolbar button, which
            // then shows a focus ring as soon as a shortcut key is pressed.
            data-autofocus
            tabIndex={-1}
            className={classes.body}
          >
            <ViewerDarkScope className={classes.viewer}>
              <div className={classes.stage}>
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
                  onRotate={rotate}
                  playing={playing}
                  setPlaying={setPlaying}
                  isFullscreen={isFullscreen}
                  toggleFullscreen={toggleFullscreen}
                  isSlideshowActive={slideshow.isSlideshowActive}
                  toggleSlideshow={slideshow.toggleSlideshow}
                  slideshowInterval={slideshow.slideshowInterval}
                  setSlideshowInterval={slideshow.setSlideshowInterval}
                  slideshowProgress={slideshow.slideshowProgress}
                  panorama={panorama}
                  hasOcrText={hasOcrText}
                  showOcrText={showOcrText}
                  toggleOcrText={toggleOcrText}
                  onCopyToClipboard={canCopyPhoto ? handleCopyPhoto : undefined}
                  onAfterTrashToggle={handleAfterTrashToggle}
                  title={toolbarTitle}
                />

                {/* Main photo/video with swipe navigation */}
                <div className={classes.media}>
                  <Carousel
                    getEmblaApi={setEmbla}
                    initialSlide={1}
                    height="100%"
                    classNames={{
                      root: classes.carousel,
                      viewport: classes.viewport,
                      container: classes.container,
                      slide: classes.slide,
                      controls: classes.controls,
                      control: classes.control,
                    }}
                    controlSize={44}
                    controlsOffset="md"
                    previousControlIcon={<ChevronLeft size={24} />}
                    nextControlIcon={<ChevronRight size={24} />}
                    slideSize="100%"
                    slideGap={0}
                    orientation="horizontal"
                    // Mantine 8 takes Embla options only here (loop: false and
                    // containScroll: "trimSnaps" are its defaults); the old
                    // `draggable` prop was silently dropped.
                    emblaOptions={{ watchDrag: !holdsDrag }}
                    // Mantine leaves the arrow buttons unnamed.
                    previousControlProps={{ "aria-label": t("lightbox.controls.previous") }}
                    nextControlProps={{ "aria-label": t("lightbox.controls.next") }}
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
                      <SlideTransition slideKey={mainSrc}>
                        <MediaDisplay
                          id={mainSrc}
                          image_hash={mainSrcHash}
                          isMainContent
                          type={mainType}
                          bind={bind}
                          faceLocation={faceLocation}
                          toggleZoom={toggleZoom}
                          scale={scale}
                          offset={offset}
                          handleDragStart={handleDragStart}
                          playing={playing}
                          onEnded={slideshow.handleVideoEnded}
                          rotationAngle={rotationAngle}
                          imageCacheKey={imageCacheKey}
                          suppressRotationTransition={suppressRotationTransition}
                          onImageLoad={onImageLoad}
                          ocrBlocks={ocrBlocks}
                          showOcrText={showOcrText}
                          drawingFace={faceDrawing.isDrawing}
                          onFaceDrawn={faceDrawing.onDrawn}
                          onCancelDrawFace={faceDrawing.cancel}
                          isPublic={isPublic}
                          panoramaActive={panorama.active}
                          onPanoramaError={panorama.fail}
                          {...(photoDetails ? { photoDetails } : {})}
                        />
                      </SlideTransition>
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
                  mainSrcHash={mainSrcHash}
                  nextSrc={nextSrc}
                  nextSrcHash={nextSrcHash}
                  onMovePrevRequest={onMovePrevRequest}
                  onMoveNextRequest={onMoveNextRequest}
                  isPublic={isPublic}
                />
              </div>

              {lightboxSidebarShow && (
                <Sidebar
                  id={mainSrcHash}
                  closeSidepanel={() => setLightBoxSidebarShow(!lightboxSidebarShow)}
                  isPublic={isPublic}
                  publicAlbumSlug={publicAlbumSlug}
                  gridItem={gridItem}
                  setFaceLocation={setFaceLocation}
                  onPhotoSelect={onPhotoSelect}
                  onAddFaceRequest={type === "photo" ? faceDrawing.start : undefined}
                  onCancelAddFace={faceDrawing.cancel}
                  isDrawingFace={faceDrawing.isDrawing}
                  addFaceBlockedReason={addFaceBlockedReason}
                />
              )}
            </ViewerDarkScope>
            {/* Only an owner adds faces; mounted on a public page, its people query would 401. */}
            {!isPublic && (
              <ModalPersonEdit
                isOpen={!!faceDrawing.drawnBox}
                onRequestClose={faceDrawing.cancel}
                selectedFaces={[]}
                prompt={t("lightbox.addface.whoisit")}
                onPersonChosen={faceDrawing.onPersonChosen}
              />
            )}
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </LightboxCommandsContext.Provider>
  );
}
