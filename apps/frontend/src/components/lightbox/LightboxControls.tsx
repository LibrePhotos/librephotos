import { ActionIcon, Divider, Group, Loader, RingProgress, Select, Tooltip } from "@mantine/core";
import {
  IconCopy as Copy,
  IconEye as Eye,
  IconEyeOff as EyeOff,
  IconGlobe as Globe,
  IconInfoCircle as InfoCircle,
  IconArrowsMaximize as Maximize,
  IconArrowsMinimize as Minimize,
  IconPlayerPause as Pause,
  IconPlayerPlay as Play,
  IconRotate2 as RotateCCW,
  IconRotateClockwise2 as RotateCW,
  IconStar as Star,
  IconTextRecognition as TextRecognition,
  IconTrash as Trash,
  IconX as X,
  IconZoomIn as ZoomIn,
  IconZoomOut as ZoomOut,
} from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useFetchPhotoSharesQuery,
  useMarkPhotosDeletedMutation,
  useSetFavoritePhotosMutation,
  useSetPhotosHiddenMutation,
} from "../../api_client/photos/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { PhotoShareLinkModal } from "../sharing/PhotoShareLinkModal";
import { copyKeyLabel } from "./lightbox.hotkeys";
import type { LightboxControlsProps } from "./lightbox.types";

// Interval options for slideshow
const INTERVAL_OPTIONS = [
  { value: "3", label: "3s" },
  { value: "5", label: "5s" },
  { value: "10", label: "10s" },
  { value: "15", label: "15s" },
  { value: "30", label: "30s" },
];

function favoriteLabel(t: TFunction, isFavorite: boolean) {
  return isFavorite ? t("lightbox.toolbar.removeFromFavorites") : t("lightbox.toolbar.addToFavorites");
}

export function LightboxControls({
  photoDetail,
  isPhotoDetailsLoading,
  lightboxSidebarShow,
  setLightBoxSidebarShow,
  isPublic,
  enableZoom,
  type,
  isZoomed,
  toggleZoom,
  onCloseRequest,
  onRotate,
  isFullscreen,
  toggleFullscreen,
  isSlideshowActive,
  toggleSlideshow,
  slideshowInterval,
  setSlideshowInterval,
  slideshowProgress,
  hasOcrText,
  showOcrText,
  toggleOcrText,
  onCopyToClipboard,
  isCopyingToClipboard = false,
}: LightboxControlsProps) {
  const { t } = useTranslation();

  // Fetch user details for favorite min rating
  const { data: userDetails } = useCurrentUserSelfDetailsQuery();
  const favoriteMinRating = userDetails?.favorite_min_rating ?? 0;

  // Mutations for photo actions
  const setPhotosHidden = useSetPhotosHiddenMutation();
  // Whether this photo has a live share link, for the globe's colour.
  const { data: photoShares } = useFetchPhotoSharesQuery(!isPublic);
  const isShared = !!photoDetail && !!photoShares?.some(share => share.photo_id === photoDetail.id);
  const [sharingPhotoId, setSharingPhotoId] = useState<string | null>(null);
  const setFavoritePhotos = useSetFavoritePhotosMutation();
  const markPhotosDeleted = useMarkPhotosDeletedMutation();

  // Keyboard shortcut handlers
  const handleFavoriteShortcut = useCallback(() => {
    if (photoDetail && !isPublic) {
      const { image_hash: imageHash } = photoDetail;
      const val = !(photoDetail.rating >= favoriteMinRating);
      setFavoritePhotos.mutate({ image_hashes: [imageHash], favorite: val });
    }
  }, [photoDetail, isPublic, favoriteMinRating, setFavoritePhotos]);

  const handleHideShortcut = useCallback(() => {
    if (photoDetail && !isPublic) {
      const { image_hash: imageHash } = photoDetail;
      const val = !photoDetail.hidden;
      setPhotosHidden.mutate({ image_hashes: [imageHash], hidden: val });
    }
  }, [photoDetail, isPublic, setPhotosHidden]);

  // A share link carries its own random slug, so it can be rotated or
  // revoked later; the old thumbnails_big URL came from the file content and
  // could never be withdrawn (issue #2028). It is independent of the photo's
  // "public" flag, which the bulk Make Public action still controls.
  const handlePublicShortcut = useCallback(() => {
    if (photoDetail && !isPublic) {
      setSharingPhotoId(photoDetail.id);
    }
  }, [photoDetail, isPublic]);

  const handleDeleteShortcut = useCallback(() => {
    if (photoDetail && !isPublic) {
      const { image_hash: imageHash } = photoDetail;
      markPhotosDeleted.mutate({ image_hashes: [imageHash], deleted: true });
    }
  }, [photoDetail, isPublic, markPhotosDeleted]);

  // Add event listeners for keyboard shortcuts
  useEffect(() => {
    const handleFavoriteEvent = () => handleFavoriteShortcut();
    const handleHideEvent = () => handleHideShortcut();
    const handlePublicEvent = () => handlePublicShortcut();
    const handleDeleteEvent = () => handleDeleteShortcut();

    window.addEventListener("lightbox-favorite-shortcut", handleFavoriteEvent);
    window.addEventListener("lightbox-hide-shortcut", handleHideEvent);
    window.addEventListener("lightbox-public-shortcut", handlePublicEvent);
    window.addEventListener("lightbox-delete-shortcut", handleDeleteEvent);

    return () => {
      window.removeEventListener("lightbox-favorite-shortcut", handleFavoriteEvent);
      window.removeEventListener("lightbox-hide-shortcut", handleHideEvent);
      window.removeEventListener("lightbox-public-shortcut", handlePublicEvent);
      window.removeEventListener("lightbox-delete-shortcut", handleDeleteEvent);
    };
  }, [handleFavoriteShortcut, handleHideShortcut, handlePublicShortcut, handleDeleteShortcut]);

  return (
    <Group gap="xs" justify="flex-end" align="center" style={{ background: "transparent" }}>
      {/* Group 1: Slideshow controls */}
      <Group gap={4} align="center">
        <Tooltip
          label={isSlideshowActive ? t("lightbox.controls.stopslideshow") : t("lightbox.controls.slideshow")}
          position="bottom"
          withArrow
        >
          <div
            style={{
              position: "relative",
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isSlideshowActive && (
              <RingProgress
                size={32}
                thickness={2}
                sections={[{ value: slideshowProgress, color: "blue" }]}
                style={{
                  position: "absolute",
                  inset: 0,
                }}
                rootColor="rgba(255,255,255,0.2)"
              />
            )}
            <ActionIcon
              variant="subtle"
              color={isSlideshowActive ? "blue" : "gray"}
              onClick={toggleSlideshow}
              size={24}
              style={{ zIndex: 1 }}
            >
              {isSlideshowActive ? <Pause size={16} /> : <Play size={16} />}
            </ActionIcon>
          </div>
        </Tooltip>
        {isSlideshowActive && (
          <Select
            size="xs"
            value={slideshowInterval.toString()}
            onChange={value => setSlideshowInterval(parseInt(value || "5", 10))}
            data={INTERVAL_OPTIONS}
            styles={{
              input: {
                width: 56,
                minHeight: 26,
                height: 26,
                backgroundColor: "transparent",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "white",
                fontSize: 12,
                paddingLeft: 8,
                paddingRight: 24,
              },
              dropdown: {
                backgroundColor: "rgba(0,0,0,0.9)",
                border: "1px solid rgba(255,255,255,0.2)",
              },
              option: {
                color: "white",
                fontSize: 12,
                "&[data-selected]": {
                  backgroundColor: "rgba(255,255,255,0.1)",
                },
                "&[data-hovered]": {
                  backgroundColor: "rgba(255,255,255,0.05)",
                },
              },
            }}
            comboboxProps={{ withinPortal: false }}
            withCheckIcon={false}
          />
        )}
      </Group>

      <Divider orientation="vertical" color="rgba(255,255,255,0.2)" />

      {/* Group 2: View controls - Live text, Zoom & Fullscreen */}
      <Group gap={4} align="center">
        {hasOcrText && (
          <Tooltip
            label={showOcrText ? t("lightbox.controls.livetextoff") : t("lightbox.controls.livetext")}
            position="bottom"
            withArrow
          >
            <ActionIcon variant="subtle" color={showOcrText ? "blue" : "gray"} onClick={toggleOcrText} size={28}>
              <TextRecognition size={18} />
            </ActionIcon>
          </Tooltip>
        )}
        {enableZoom && type === "photo" && (
          <Tooltip label={t("lightbox.controls.zoom")} position="bottom" withArrow>
            <ActionIcon variant="subtle" color="gray" onClick={toggleZoom} size={28}>
              {isZoomed ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
            </ActionIcon>
          </Tooltip>
        )}
        {onCopyToClipboard && (
          <Tooltip label={t("lightbox.controls.copy", { shortcut: copyKeyLabel() })} position="bottom" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={onCopyToClipboard}
              loading={isCopyingToClipboard}
              size={28}
              aria-label={t("lightbox.controls.copy", { shortcut: copyKeyLabel() })}
            >
              <Copy size={18} />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip
          label={isFullscreen ? t("lightbox.controls.exitfullscreen") : t("lightbox.controls.fullscreen")}
          position="bottom"
          withArrow
        >
          <ActionIcon variant="subtle" color="gray" onClick={toggleFullscreen} size={28}>
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </ActionIcon>
        </Tooltip>
      </Group>

      {/* Group 3: Metadata controls - Hide, Favorite, Public, Delete (only for authenticated users) */}
      {!isPublic && (
        <>
          <Divider orientation="vertical" color="rgba(255,255,255,0.2)" />
          <Group gap={4} align="center">
            {isPhotoDetailsLoading && (
              <ActionIcon loading variant="transparent" size={28}>
                <Loader size={16} color="grey" />
              </ActionIcon>
            )}
            {!isPhotoDetailsLoading && photoDetail && (
              <Tooltip label={photoDetail.hidden ? "Show photo (H)" : "Hide photo (H)"} position="bottom" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={28}
                  onClick={() => {
                    const { image_hash: imageHash } = photoDetail;
                    const val = !photoDetail.hidden;
                    setPhotosHidden.mutate({ image_hashes: [imageHash], hidden: val });
                  }}
                >
                  {photoDetail.hidden ? <EyeOff size={18} color="red" /> : <Eye size={18} />}
                </ActionIcon>
              </Tooltip>
            )}
            {photoDetail && (
              <Tooltip label={favoriteLabel(t, photoDetail.rating >= favoriteMinRating)} position="bottom" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={28}
                  aria-label={favoriteLabel(t, photoDetail.rating >= favoriteMinRating)}
                  onClick={() => {
                    const { image_hash: imageHash } = photoDetail;
                    const val = !(photoDetail.rating >= favoriteMinRating);
                    setFavoritePhotos.mutate({ image_hashes: [imageHash], favorite: val });
                  }}
                >
                  <Star size={18} color={photoDetail.rating >= favoriteMinRating ? "yellow" : "grey"} />
                </ActionIcon>
              </Tooltip>
            )}
            {photoDetail && (
              <Tooltip label={t("sharing.shareLinkShortcut")} position="bottom" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={28}
                  aria-label={t("sharing.shareLinkShortcut")}
                  onClick={() => setSharingPhotoId(photoDetail.id)}
                >
                  <Globe size={18} color={isShared ? "green" : "grey"} />
                </ActionIcon>
              </Tooltip>
            )}
            {photoDetail && (
              <Tooltip label="Delete photo (D)" position="bottom" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={28}
                  onClick={() => {
                    const { image_hash: imageHash } = photoDetail;
                    markPhotosDeleted.mutate({ image_hashes: [imageHash], deleted: true });
                  }}
                >
                  <Trash size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {photoDetail && (
              <Tooltip label={t("lightbox.toolbar.rotateCCW")} position="bottom" withArrow>
                <ActionIcon variant="subtle" color="gray" size={28} onClick={() => onRotate(-90)}>
                  <RotateCCW size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {photoDetail && (
              <Tooltip label={t("lightbox.toolbar.rotateCW")} position="bottom" withArrow>
                <ActionIcon variant="subtle" color="gray" size={28} onClick={() => onRotate(90)}>
                  <RotateCW size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
          <Divider orientation="vertical" color="rgba(255,255,255,0.2)" />
          <PhotoShareLinkModal photoId={sharingPhotoId} onClose={() => setSharingPhotoId(null)} />
        </>
      )}

      {/* Group 4: Panel controls - Info toggle & Close (sidebar toggle right next to X) */}
      <Group gap={4} align="center">
        <Tooltip
          label={lightboxSidebarShow ? "Hide info panel (I)" : "Show info panel (I)"}
          position="bottom"
          withArrow
        >
          <ActionIcon
            variant="subtle"
            color={lightboxSidebarShow ? "blue" : "gray"}
            size={28}
            onClick={() => setLightBoxSidebarShow(!lightboxSidebarShow)}
          >
            <InfoCircle size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("lightbox.controls.close")} position="bottom" withArrow>
          <ActionIcon variant="subtle" color="gray" size={28} onClick={onCloseRequest}>
            <X size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
