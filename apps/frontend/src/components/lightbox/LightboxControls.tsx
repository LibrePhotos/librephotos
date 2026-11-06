import { Loader, RingProgress, Select } from "@mantine/core";
import {
  IconArrowLeft as ArrowLeft,
  IconInfoCircle as InfoCircle,
  IconInfoCircleFilled as InfoCircleFilled,
  IconPlayerPause as Pause,
} from "@tabler/icons-react";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PhotoShareLinkModal } from "../sharing/PhotoShareLinkModal";
import { copyKeyLabel } from "./lightbox.hotkeys";
import type { LightboxControlsProps } from "./lightbox.types";
import { useLightboxCommands } from "./lightboxCommands";
import classes from "./LightboxControls.module.css";
import { LightboxMoreMenu, ShareButton, TrashButton } from "./LightboxPhotoActions";
import { LightboxRating } from "./LightboxRating";
import { LightboxToolbarButton, TOOLBAR_ICON_SIZE } from "./LightboxToolbarButton";
import { LightboxViewControls } from "./LightboxViewControls";
import { useCompactViewer } from "./useCompactViewer";
import { usePhotoActions } from "./usePhotoActions";

// Interval options for slideshow
const INTERVAL_OPTIONS = [
  { value: "3", label: "3s" },
  { value: "5", label: "5s" },
  { value: "10", label: "10s" },
  { value: "15", label: "15s" },
  { value: "30", label: "30s" },
];

type SlideshowProps = Pick<
  LightboxControlsProps,
  "toggleSlideshow" | "slideshowInterval" | "setSlideshowInterval" | "slideshowProgress"
> & { label: string };

/**
 * A running slideshow: pause, inside its progress ring, and the interval picker. Starting one is in
 * the ⋮ menu (and S).
 */
function RunningSlideshow({
  label,
  toggleSlideshow,
  slideshowInterval,
  setSlideshowInterval,
  slideshowProgress,
}: SlideshowProps) {
  const intervalRef = useRef<HTMLInputElement>(null);
  return (
    <>
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
            border: "1px solid var(--app-scrim-white-20)",
            color: "white",
            fontSize: 12,
            paddingLeft: 8,
            paddingRight: 24,
          },
          dropdown: {
            backgroundColor: "var(--app-scrim-black-90)",
            border: "1px solid var(--app-scrim-white-20)",
          },
        }}
        // Hover cannot be styled inline, so the options live in a module.
        classNames={{ dropdown: classes.intervalDropdown, option: classes.intervalOption }}
        comboboxProps={{ withinPortal: false }}
        withCheckIcon={false}
      />
      <div className={classes.ring}>
        <RingProgress
          size={40}
          thickness={2}
          sections={[{ value: slideshowProgress, color: "blue" }]}
          className={classes.ringProgress}
          rootColor="var(--app-scrim-white-20)"
        />
        <LightboxToolbarButton label={label} onClick={toggleSlideshow}>
          <Pause size={TOOLBAR_ICON_SIZE} />
        </LightboxToolbarButton>
      </div>
    </>
  );
}

/**
 * The lightbox toolbar, over the top of the photo on a soft gradient: back on the left, the photo's
 * date, place and position in the middle (`title`); on the right the buttons used most, in Google
 * Photos' and Immich's order (360° view and live text when the photo has them, then Share,
 * favorite or stars, Info, Delete) and a ⋮ with the rest, labelled, zoom included. On a phone
 * (useCompactViewer) the top keeps back, a one-line date, favorite and ⋮, and Share, Info and
 * Delete move to a bar at the bottom, under the thumb. Every action keeps its keyboard shortcut.
 */
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
  onAfterTrashToggle,
  panorama,
  title,
}: LightboxControlsProps) {
  const { t } = useTranslation();
  const compact = useCompactViewer();

  // Favourite, hide, archive, share link and trash, as the photo page has them too.
  const actions = usePhotoActions({ photoDetail, isPublic, onAfterTrashToggle });

  // The keyboard shortcuts of the lightbox that owns this toolbar
  const commands = useLightboxCommands();
  useEffect(() => {
    const unsubscribers = [
      commands.on("favorite", actions.toggleFavorite),
      commands.on("rate", actions.setRating),
      commands.on("hide", actions.toggleHidden),
      commands.on("archive", actions.toggleArchived),
      commands.on("public", actions.openShareLink),
      commands.on("delete", actions.toggleTrash),
    ];
    return () => unsubscribers.forEach(off => off());
  }, [
    commands,
    actions.toggleFavorite,
    actions.setRating,
    actions.toggleHidden,
    actions.toggleArchived,
    actions.openShareLink,
    actions.toggleTrash,
  ]);

  const slideshowLabel = isSlideshowActive ? t("lightbox.controls.stopslideshow") : t("lightbox.controls.slideshow");
  const copyLabel = t("lightbox.controls.copy", { shortcut: copyKeyLabel() });
  const fullscreenLabel = isFullscreen ? t("lightbox.controls.exitfullscreen") : t("lightbox.controls.fullscreen");
  const infoLabel = lightboxSidebarShow ? t("lightbox.toolbar.hideInfoPanel") : t("lightbox.toolbar.showInfoPanel");
  const ownPhoto = !isPublic && photoDetail ? photoDetail : null;
  const activePanorama = panorama?.available ? panorama : undefined;
  // The 360° view zooms itself: the item stays, saying why it does nothing.
  const zoom =
    enableZoom && type === "photo"
      ? {
          isZoomed,
          toggle: toggleZoom,
          blockedReason: !!activePanorama?.active && t("lightbox.panorama.zoominviewer"),
        }
      : undefined;

  const share = ownPhoto && <ShareButton actions={actions} />;
  const info = (
    <LightboxToolbarButton label={infoLabel} onClick={() => setLightBoxSidebarShow(!lightboxSidebarShow)}>
      {lightboxSidebarShow ? <InfoCircleFilled size={TOOLBAR_ICON_SIZE} /> : <InfoCircle size={TOOLBAR_ICON_SIZE} />}
    </LightboxToolbarButton>
  );
  const trash = ownPhoto && <TrashButton actions={actions} />;

  return (
    <>
      <div className={classes.bar} data-compact={compact || undefined}>
        <LightboxToolbarButton label={t("lightbox.controls.close")} onClick={onCloseRequest}>
          <ArrowLeft size={TOOLBAR_ICON_SIZE} />
        </LightboxToolbarButton>
        {title}

        <div className={classes.actions}>
          {isSlideshowActive && (
            <RunningSlideshow
              label={slideshowLabel}
              toggleSlideshow={toggleSlideshow}
              slideshowInterval={slideshowInterval}
              setSlideshowInterval={setSlideshowInterval}
              slideshowProgress={slideshowProgress}
            />
          )}
          <LightboxViewControls
            hasOcrText={hasOcrText}
            showOcrText={showOcrText}
            toggleOcrText={toggleOcrText}
            panorama={activePanorama}
          />
          {!isPublic && isPhotoDetailsLoading && (
            // Not a button: nothing to press while the details load. The 40px slot keeps the row still.
            <Loader size={TOOLBAR_ICON_SIZE} color="gray" mx={10} />
          )}
          {!compact && share}
          {ownPhoto && <LightboxRating actions={actions} />}
          {!compact && info}
          {!compact && trash}
          <LightboxMoreMenu
            actions={actions}
            ownPhoto={ownPhoto}
            zoom={zoom}
            canRotate={type !== "video"}
            onRotate={onRotate}
            slideshowLabel={slideshowLabel}
            isSlideshowActive={isSlideshowActive}
            toggleSlideshow={toggleSlideshow}
            onCopyToClipboard={onCopyToClipboard}
            copyLabel={copyLabel}
            isFullscreen={isFullscreen}
            toggleFullscreen={toggleFullscreen}
            fullscreenLabel={fullscreenLabel}
          />
        </div>
        {!isPublic && <PhotoShareLinkModal photoId={actions.sharingPhotoId} onClose={actions.closeShareLink} />}
      </div>
      {compact && (
        <div className={classes.bottomBar}>
          {share}
          {info}
          {trash}
        </div>
      )}
    </>
  );
}
