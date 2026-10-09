import {
  ActionIcon,
  Divider,
  Group,
  Loader,
  Menu,
  RingProgress,
  Select,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconCopy as Copy,
  IconDotsVertical as Dots,
  IconEye as Eye,
  IconEyeOff as EyeOff,
  IconGlobe as Globe,
  IconInfoCircle as InfoCircle,
  IconArrowsMaximize as Maximize,
  IconArrowsMinimize as Minimize,
  IconPlayerPause as Pause,
  IconPlayerPlay as Play,
  IconArrowBackUp as Restore,
  IconRotate2 as RotateCCW,
  IconRotateClockwise2 as RotateCW,
  IconStar as Star,
  IconStarFilled as StarFilled,
  IconTextRecognition as TextRecognition,
  IconTrash as Trash,
  IconX as X,
  IconZoomIn as ZoomIn,
  IconZoomOut as ZoomOut,
} from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import classes from "./LightboxControls.module.css";

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
  onAfterTrashToggle,
}: LightboxControlsProps) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  // A phone cannot fit every button in one row; the owner's photo actions move
  // into a menu there instead of wrapping the toolbar onto a second row.
  const isNarrow = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

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
  const intervalRef = useRef<HTMLInputElement>(null);

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

  // In the trash the same button and D restore the photo instead: trashing
  // it again was a no-op that reported "0 photos moved to trash".
  const inTrash = !!photoDetail?.in_trashcan;
  const handleToggleTrash = useCallback(() => {
    if (photoDetail && !isPublic) {
      const { image_hash: imageHash } = photoDetail;
      markPhotosDeleted.mutate(
        { image_hashes: [imageHash], deleted: !inTrash },
        { onSuccess: () => onAfterTrashToggle?.() }
      );
    }
  }, [photoDetail, isPublic, inTrash, markPhotosDeleted, onAfterTrashToggle]);

  // Add event listeners for keyboard shortcuts
  useEffect(() => {
    const handleFavoriteEvent = () => handleFavoriteShortcut();
    const handleHideEvent = () => handleHideShortcut();
    const handlePublicEvent = () => handlePublicShortcut();
    const handleDeleteEvent = () => handleToggleTrash();

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
  }, [handleFavoriteShortcut, handleHideShortcut, handlePublicShortcut, handleToggleTrash]);

  const slideshowLabel = isSlideshowActive ? t("lightbox.controls.stopslideshow") : t("lightbox.controls.slideshow");
  const liveTextLabel = showOcrText ? t("lightbox.controls.livetextoff") : t("lightbox.controls.livetext");
  const copyLabel = t("lightbox.controls.copy", { shortcut: copyKeyLabel() });
  const fullscreenLabel = isFullscreen ? t("lightbox.controls.exitfullscreen") : t("lightbox.controls.fullscreen");
  const infoLabel = lightboxSidebarShow ? t("lightbox.toolbar.hideInfoPanel") : t("lightbox.toolbar.showInfoPanel");
  const hideLabel = photoDetail?.hidden ? t("lightbox.toolbar.showPhoto") : t("lightbox.toolbar.hidePhoto");
  const trashLabel = inTrash ? t("lightbox.toolbar.restorePhoto") : t("lightbox.toolbar.deletePhoto");
  const isFavorite = !!photoDetail && photoDetail.rating >= favoriteMinRating;
  // The server refuses to rotate a video, and the player would not show it.
  const canRotate = type !== "video";
  const toggleHidden = () => {
    if (!photoDetail) return;
    setPhotosHidden.mutate({ image_hashes: [photoDetail.image_hash], hidden: !photoDetail.hidden });
  };
  const hideIcon = photoDetail?.hidden ? <EyeOff size={18} color="var(--mantine-color-red-6)" /> : <Eye size={18} />;
  const shareIcon = <Globe size={18} color={isShared ? "var(--mantine-color-green-6)" : undefined} />;
  const trashIcon = inTrash ? <Restore size={18} /> : <Trash size={18} />;
  // Copy and fullscreen join the menu on a phone too, to leave room for it.
  const actionsInMenu = !!isNarrow && !isPublic;
  const canZoom = enableZoom && type === "photo";
  // A video on a phone has nothing left in this group; no group, no divider.
  const showViewGroup = hasOcrText || canZoom || !actionsInMenu;
  // Details that failed to load leave the photo-actions group empty, and an
  // empty group put two dividers side by side. The phone menu still holds copy
  // and fullscreen.
  const showMetaGroup = isPhotoDetailsLoading || !!photoDetail || actionsInMenu;

  return (
    <Group gap="xs" justify="flex-end" align="center" style={{ background: "transparent" }}>
      {/* Group 1: Slideshow controls */}
      <Group gap={4} align="center">
        <Tooltip label={slideshowLabel} position="bottom" withArrow>
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
              size={28}
              radius="xl"
              aria-label={slideshowLabel}
              style={{ zIndex: 1 }}
            >
              {isSlideshowActive ? <Pause size={18} /> : <Play size={18} />}
            </ActionIcon>
          </div>
        </Tooltip>
        {isSlideshowActive && (
          <Select
            ref={intervalRef}
            size="xs"
            value={slideshowInterval.toString()}
            onChange={value => setSlideshowInterval(parseInt(value || "5", 10))}
            // Focus would stay in the picker's input, where the lightbox's
            // shortcuts (Escape, the arrows, S) are ignored; hand it back.
            onOptionSubmit={() => intervalRef.current?.closest<HTMLElement>(".mantine-Modal-body")?.focus()}
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
            }}
            // Hover cannot be styled inline, so the options live in a module.
            classNames={{ dropdown: classes.intervalDropdown, option: classes.intervalOption }}
            comboboxProps={{ withinPortal: false }}
            withCheckIcon={false}
          />
        )}
      </Group>

      {/* Group 2: View controls - Live text, Zoom & Fullscreen */}
      {showViewGroup && <Divider orientation="vertical" color="rgba(255,255,255,0.2)" />}
      {showViewGroup && (
        <Group gap={4} align="center">
          {hasOcrText && (
            <Tooltip label={liveTextLabel} position="bottom" withArrow>
              <ActionIcon
                variant="subtle"
                color={showOcrText ? "blue" : "gray"}
                onClick={toggleOcrText}
                size={28}
                aria-label={liveTextLabel}
              >
                <TextRecognition size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          {canZoom && (
            <Tooltip label={t("lightbox.controls.zoom")} position="bottom" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={toggleZoom}
                size={28}
                aria-label={t("lightbox.controls.zoom")}
                // Only zoom keeps one label, so only it reports its state here;
                // the other toggles say theirs in the label, and both would be
                // read out twice.
                aria-pressed={isZoomed}
              >
                {isZoomed ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
              </ActionIcon>
            </Tooltip>
          )}
          {onCopyToClipboard && !actionsInMenu && (
            <Tooltip label={copyLabel} position="bottom" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={onCopyToClipboard}
                loading={isCopyingToClipboard}
                size={28}
                aria-label={copyLabel}
              >
                <Copy size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          {!actionsInMenu && (
            <Tooltip label={fullscreenLabel} position="bottom" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={toggleFullscreen}
                size={28}
                aria-label={fullscreenLabel}
              >
                {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      )}

      {/* Group 3: Metadata controls - Hide, Favorite, Public, Delete (only for authenticated users) */}
      {!isPublic && showMetaGroup && (
        <>
          <Divider orientation="vertical" color="rgba(255,255,255,0.2)" />
          <Group gap={4} align="center">
            {isPhotoDetailsLoading && (
              <ActionIcon loading variant="transparent" size={28}>
                <Loader size={16} color="grey" />
              </ActionIcon>
            )}
            {!isPhotoDetailsLoading && photoDetail && !actionsInMenu && (
              <Tooltip label={hideLabel} position="bottom" withArrow>
                <ActionIcon variant="subtle" color="gray" size={28} aria-label={hideLabel} onClick={toggleHidden}>
                  {hideIcon}
                </ActionIcon>
              </Tooltip>
            )}
            {photoDetail && (
              <Tooltip label={favoriteLabel(t, isFavorite)} position="bottom" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={28}
                  aria-label={favoriteLabel(t, isFavorite)}
                  onClick={() => {
                    setFavoritePhotos.mutate({ image_hashes: [photoDetail.image_hash], favorite: !isFavorite });
                  }}
                >
                  {isFavorite ? <StarFilled size={18} color="var(--mantine-color-yellow-5)" /> : <Star size={18} />}
                </ActionIcon>
              </Tooltip>
            )}
            {photoDetail && !actionsInMenu && (
              <Tooltip label={t("sharing.shareLinkShortcut")} position="bottom" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={28}
                  aria-label={t("sharing.shareLinkShortcut")}
                  onClick={() => setSharingPhotoId(photoDetail.id)}
                >
                  {shareIcon}
                </ActionIcon>
              </Tooltip>
            )}
            {photoDetail && !actionsInMenu && (
              <Tooltip label={trashLabel} position="bottom" withArrow>
                <ActionIcon variant="subtle" color="gray" size={28} aria-label={trashLabel} onClick={handleToggleTrash}>
                  {trashIcon}
                </ActionIcon>
              </Tooltip>
            )}
            {photoDetail && canRotate && !actionsInMenu && (
              <Tooltip label={t("lightbox.toolbar.rotateCCW")} position="bottom" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={28}
                  aria-label={t("lightbox.toolbar.rotateCCW")}
                  onClick={() => onRotate(-90)}
                >
                  <RotateCCW size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {photoDetail && canRotate && !actionsInMenu && (
              <Tooltip label={t("lightbox.toolbar.rotateCW")} position="bottom" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={28}
                  aria-label={t("lightbox.toolbar.rotateCW")}
                  onClick={() => onRotate(90)}
                >
                  <RotateCW size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            {actionsInMenu && (
              // Kept inside the lightbox: a portal would not show in fullscreen.
              <Menu position="bottom-end" withinPortal={false}>
                <Menu.Target>
                  <ActionIcon variant="subtle" color="gray" size={28} aria-label={t("lightbox.toolbar.moreActions")}>
                    <Dots size={18} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  {photoDetail && (
                    <Menu.Item leftSection={hideIcon} onClick={toggleHidden}>
                      {hideLabel}
                    </Menu.Item>
                  )}
                  {photoDetail && (
                    <Menu.Item leftSection={shareIcon} onClick={() => setSharingPhotoId(photoDetail.id)}>
                      {t("sharing.shareLinkShortcut")}
                    </Menu.Item>
                  )}
                  {photoDetail && (
                    <Menu.Item leftSection={trashIcon} onClick={handleToggleTrash}>
                      {trashLabel}
                    </Menu.Item>
                  )}
                  {photoDetail && canRotate && (
                    <Menu.Item leftSection={<RotateCCW size={18} />} onClick={() => onRotate(-90)}>
                      {t("lightbox.toolbar.rotateCCW")}
                    </Menu.Item>
                  )}
                  {photoDetail && canRotate && (
                    <Menu.Item leftSection={<RotateCW size={18} />} onClick={() => onRotate(90)}>
                      {t("lightbox.toolbar.rotateCW")}
                    </Menu.Item>
                  )}
                  {onCopyToClipboard && (
                    <Menu.Item leftSection={<Copy size={18} />} onClick={onCopyToClipboard}>
                      {copyLabel}
                    </Menu.Item>
                  )}
                  <Menu.Item
                    leftSection={isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                    onClick={toggleFullscreen}
                  >
                    {fullscreenLabel}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        </>
      )}
      {!isPublic && <PhotoShareLinkModal photoId={sharingPhotoId} onClose={() => setSharingPhotoId(null)} />}

      {/* Group 4: Panel controls - Info toggle & Close (sidebar toggle right next to X).
          Its divider is not part of group 3, which a public page and a photo
          without details do not have. */}
      <Divider orientation="vertical" color="rgba(255,255,255,0.2)" />
      <Group gap={4} align="center">
        <Tooltip label={infoLabel} position="bottom" withArrow>
          <ActionIcon
            variant="subtle"
            color={lightboxSidebarShow ? "blue" : "gray"}
            size={28}
            aria-label={infoLabel}
            onClick={() => setLightBoxSidebarShow(!lightboxSidebarShow)}
          >
            <InfoCircle size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("lightbox.controls.close")} position="bottom" withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={28}
            aria-label={t("lightbox.controls.close")}
            onClick={onCloseRequest}
          >
            <X size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
