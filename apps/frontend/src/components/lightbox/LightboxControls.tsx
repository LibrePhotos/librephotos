import { ActionIcon, Divider, Group, Loader, RingProgress, Select, Tooltip } from "@mantine/core";
import {
  IconArrowsMaximize as Maximize,
  IconArrowsMinimize as Minimize,
  IconEye as Eye,
  IconEyeOff as EyeOff,
  IconGlobe as Globe,
  IconInfoCircle as InfoCircle,
  IconPlayerPause as Pause,
  IconPlayerPlay as Play,
  IconStar as Star,
  IconTrash as Trash,
  IconX as X,
  IconZoomIn as ZoomIn,
  IconZoomOut as ZoomOut,
} from "@tabler/icons-react";
import React, { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { shareAddress } from "../../api_client/apiClient";
import {
  useMarkPhotosDeletedMutation,
  useSetFavoritePhotosMutation,
  useSetPhotosHiddenMutation,
  useSetPhotosPublicMutation,
} from "../../api_client/photos/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { copyToClipboard } from "../../util/util";
import type { LightboxControlsProps } from "./lightbox.types";

// Interval options for slideshow
const INTERVAL_OPTIONS = [
  { value: "3", label: "3s" },
  { value: "5", label: "5s" },
  { value: "10", label: "10s" },
  { value: "15", label: "15s" },
  { value: "30", label: "30s" },
];

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
  isFullscreen,
  toggleFullscreen,
  isSlideshowActive,
  toggleSlideshow,
  slideshowInterval,
  setSlideshowInterval,
  slideshowProgress,
}: LightboxControlsProps) {
  const { t } = useTranslation();

  // Fetch user details for favorite min rating
  const { data: userDetails } = useCurrentUserSelfDetailsQuery();
  const favoriteMinRating = userDetails?.favorite_min_rating ?? 0;

  // Mutations for photo actions
  const setPhotosHidden = useSetPhotosHiddenMutation();
  const setPhotosPublic = useSetPhotosPublicMutation();
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

  const handlePublicShortcut = useCallback(() => {
    if (photoDetail && !isPublic) {
      const { image_hash: imageHash } = photoDetail;
      const val = !photoDetail.public;
      setPhotosPublic.mutate({ image_hashes: [imageHash], val_public: val });
      copyToClipboard(`${shareAddress}/media/thumbnails_big/${imageHash}`);
    }
  }, [photoDetail, isPublic, setPhotosPublic]);

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

      {/* Group 2: View controls - Zoom & Fullscreen */}
      <Group gap={4} align="center">
        {enableZoom && type === "photo" && (
          <Tooltip label={t("lightbox.controls.zoom")} position="bottom" withArrow>
            <ActionIcon variant="subtle" color="gray" onClick={toggleZoom} size={28}>
              {isZoomed ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
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

      <Divider orientation="vertical" color="rgba(255,255,255,0.2)" />

      {/* Group 3: Metadata controls - Hide, Favorite, Public, Delete */}
      <Group gap={4} align="center">
        {isPhotoDetailsLoading && (
          <ActionIcon loading variant="transparent" size={28}>
            <Loader size={16} color="grey" />
          </ActionIcon>
        )}
        {!isPhotoDetailsLoading && photoDetail && !isPublic && (
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
        {photoDetail && !isPublic && (
          <Tooltip
            label={photoDetail.rating >= favoriteMinRating ? "Remove from favorites (F)" : "Add to favorites (F)"}
            position="bottom"
            withArrow
          >
            <ActionIcon
              variant="subtle"
              color="gray"
              size={28}
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
        {photoDetail && !isPublic && (
          <Tooltip label={photoDetail.public ? "Make private (P)" : "Make public (P)"} position="bottom" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              size={28}
              onClick={() => {
                const { image_hash: imageHash } = photoDetail;
                const val = !photoDetail.public;
                setPhotosPublic.mutate({ image_hashes: [imageHash], val_public: val });
                copyToClipboard(`${shareAddress}/media/thumbnails_big/${imageHash}`);
              }}
            >
              <Globe size={18} color={photoDetail.public ? "green" : "grey"} />
            </ActionIcon>
          </Tooltip>
        )}
        {photoDetail && !isPublic && (
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
      </Group>

      <Divider orientation="vertical" color="rgba(255,255,255,0.2)" />

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
