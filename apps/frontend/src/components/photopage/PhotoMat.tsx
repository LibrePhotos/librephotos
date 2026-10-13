import type { NormalizedFaceBox, Photo } from "@librephotos/api-client";
import { ActionIcon, Button, Tooltip } from "@mantine/core";
import { IconArrowLeft, IconArrowsMaximize, IconTextRecognition } from "@tabler/icons-react";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FaceLocationType } from "../lightbox/lightbox.types";
import { MediaDisplay } from "../lightbox/MediaDisplay";
import type { usePhotoRotation } from "../lightbox/usePhotoRotation";
import classes from "./PhotoPage.module.css";

type Props = Readonly<{
  photo: Photo;
  /** Live text and drawing a face are the owner's. */
  isOwner: boolean;
  /** The box of the face the pointer is on in the People card. */
  faceLocation: FaceLocationType;
  rotation: Pick<
    ReturnType<typeof usePhotoRotation>,
    "rotationAngle" | "imageCacheKey" | "suppressRotationTransition" | "onImageLoad"
  >;
  faceDrawing: {
    isDrawing: boolean;
    onDrawn: (box: NormalizedFaceBox) => void;
    cancel: () => void;
  };
  onOpenViewer: () => void;
}>;

/** Back to where the page was opened from, or to the timeline when it was opened from a link. */
function useBack() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  return () => {
    if (canGoBack) router.history.back();
    else void navigate({ to: "/" });
  };
}

/**
 * The photo (or video) as large as the window allows, on a neutral mat that
 * frames it in both colour schemes, with Back above it and the view tools
 * (live text, the viewer for zoom, fullscreen and the keyboard) below.
 */
export function PhotoMat({ photo, isOwner, faceLocation, rotation, faceDrawing, onOpenViewer }: Props) {
  const { t } = useTranslation();
  const back = useBack();
  const [showOcrText, setShowOcrText] = useState(false);
  // The server sends recognised text to the owner only.
  const ocrBlocks = photo.ocr?.blocks;
  const hasOcrText = isOwner && !photo.video && !!ocrBlocks && ocrBlocks.length > 0;
  const liveTextLabel = showOcrText ? t("photopage.livetextoff") : t("photopage.livetext");

  return (
    <div className={classes.mat}>
      <Button
        variant="default"
        size="xs"
        radius="xl"
        className={classes.back}
        leftSection={<IconArrowLeft size={16} />}
        onClick={back}
      >
        {t("photopage.back")}
      </Button>
      <div className={classes.media}>
        <MediaDisplay
          id={photo.image_hash}
          image_hash={photo.image_hash}
          isMainContent
          type={photo.video ? "video" : "photo"}
          faceLocation={faceLocation}
          handleDragStart={() => {}}
          fullHeight
          photoDetails={photo}
          // A viewer who is not the owner gets the original, as in the lightbox.
          isPublic={!isOwner}
          rotationAngle={rotation.rotationAngle}
          imageCacheKey={rotation.imageCacheKey}
          suppressRotationTransition={rotation.suppressRotationTransition}
          onImageLoad={rotation.onImageLoad}
          ocrBlocks={hasOcrText ? ocrBlocks : undefined}
          showOcrText={hasOcrText && showOcrText}
          drawingFace={isOwner && faceDrawing.isDrawing}
          onFaceDrawn={faceDrawing.onDrawn}
          onCancelDrawFace={faceDrawing.cancel}
        />
      </div>
      <div className={classes.tools}>
        {hasOcrText && (
          <Tooltip label={liveTextLabel}>
            <ActionIcon
              variant={showOcrText ? "filled" : "default"}
              size="lg"
              radius="xl"
              aria-label={liveTextLabel}
              onClick={() => setShowOcrText(shown => !shown)}
            >
              <IconTextRecognition size={18} />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip label={t("photopage.openinviewerhint")}>
          <ActionIcon
            variant="default"
            size="lg"
            radius="xl"
            aria-label={t("photopage.openinviewer")}
            onClick={onOpenViewer}
          >
            <IconArrowsMaximize size={18} />
          </ActionIcon>
        </Tooltip>
      </div>
    </div>
  );
}
