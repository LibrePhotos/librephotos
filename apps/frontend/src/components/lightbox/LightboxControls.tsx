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
  IconTextRecognition as TextRecognition,
  IconTrash as Trash,
  IconX as X,
  IconZoomIn as ZoomIn,
  IconZoomOut as ZoomOut,
} from "@tabler/icons-react";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { PhotoShareLinkModal } from "../sharing/PhotoShareLinkModal";
import { copyKeyLabel } from "./lightbox.hotkeys";
import type { LightboxControlsProps } from "./lightbox.types";
import { useLightboxCommands } from "./lightboxCommands";
import classes from "./LightboxControls.module.css";
import { LightboxRating } from "./LightboxRating";
import { usePhotoActions } from "./usePhotoActions";

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

  // Favourite, hide, share link and trash, as the photo page has them too.
  const actions = usePhotoActions({ photoDetail, isPublic, onAfterTrashToggle });
  const intervalRef = useRef<HTMLInputElement>(null);

  // The keyboard shortcuts of the lightbox that owns this toolbar
  const commands = useLightboxCommands();
  useEffect(() => {
    const unsubscribers = [
      commands.on("favorite", actions.toggleFavorite),
      commands.on("rate", actions.setRating),
      commands.on("hide", actions.toggleHidden),
      commands.on("public", actions.openShareLink),
      commands.on("delete", actions.toggleTrash),
    ];
    return () => unsubscribers.forEach(off => off());
  }, [
    commands,
    actions.toggleFavorite,
    actions.setRating,
    actions.toggleHidden,
    actions.openShareLink,
    actions.toggleTrash,
  ]);

  const slideshowLabel = isSlideshowActive ? t("lightbox.controls.stopslideshow") : t("lightbox.controls.slideshow");
  const liveTextLabel = showOcrText ? t("lightbox.controls.livetextoff") : t("lightbox.controls.livetext");
  const copyLabel = t("lightbox.controls.copy", { shortcut: copyKeyLabel() });
  const fullscreenLabel = isFullscreen ? t("lightbox.controls.exitfullscreen") : t("lightbox.controls.fullscreen");
  const infoLabel = lightboxSidebarShow ? t("lightbox.toolbar.hideInfoPanel") : t("lightbox.toolbar.showInfoPanel");
  const { toggleHidden, toggleTrash } = actions;
  const hideLabel = actions.isHidden ? t("lightbox.toolbar.showPhoto") : t("lightbox.toolbar.hidePhoto");
  const trashLabel = actions.inTrash ? t("lightbox.toolbar.restorePhoto") : t("lightbox.toolbar.deletePhoto");
  const shareLabel = t("sharing.shareLinkShortcut");
  // The server refuses to rotate a video, and the player would not show it.
  const canRotate = type !== "video";
  const hideIcon = actions.isHidden ? (
    <EyeOff size={ICON_SIZE.lightbox} color="var(--mantine-color-red-6)" />
  ) : (
    <Eye size={ICON_SIZE.lightbox} />
  );
  const shareIcon = (
    <Globe size={ICON_SIZE.lightbox} color={actions.isShared ? "var(--mantine-color-green-6)" : undefined} />
  );
  const trashIcon = actions.inTrash ? <Restore size={ICON_SIZE.lightbox} /> : <Trash size={ICON_SIZE.lightbox} />;
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
                rootColor="var(--app-scrim-white-20)"
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
              {isSlideshowActive ? <Pause size={ICON_SIZE.lightbox} /> : <Play size={ICON_SIZE.lightbox} />}
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
        )}
      </Group>

      {/* Group 2: View controls - Live text, Zoom & Fullscreen */}
      {showViewGroup && <Divider orientation="vertical" color="var(--app-scrim-white-20)" />}
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
                <TextRecognition size={ICON_SIZE.lightbox} />
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
                {isZoomed ? <ZoomOut size={ICON_SIZE.lightbox} /> : <ZoomIn size={ICON_SIZE.lightbox} />}
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
                <Copy size={ICON_SIZE.lightbox} />
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
                {isFullscreen ? <Minimize size={ICON_SIZE.lightbox} /> : <Maximize size={ICON_SIZE.lightbox} />}
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      )}

      {/* Group 3: Metadata controls - Hide, Favorite or stars, Public, Delete (only for authenticated users) */}
      {!isPublic && showMetaGroup && (
        <>
          <Divider orientation="vertical" color="var(--app-scrim-white-20)" />
          <Group gap={4} align="center">
            {isPhotoDetailsLoading && (
              // Not a button: nothing to press while the details load. mx keeps the 28px slot.
              <Loader size={ICON_SIZE.inline} color="grey" mx={6} />
            )}
            {!isPhotoDetailsLoading && photoDetail && !actionsInMenu && (
              <Tooltip label={hideLabel} position="bottom" withArrow>
                <ActionIcon variant="subtle" color="gray" size={28} aria-label={hideLabel} onClick={toggleHidden}>
                  {hideIcon}
                </ActionIcon>
              </Tooltip>
            )}
            {photoDetail && <LightboxRating actions={actions} />}
            {photoDetail && !actionsInMenu && (
              <Tooltip label={shareLabel} position="bottom" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={28}
                  aria-label={shareLabel}
                  onClick={actions.openShareLink}
                >
                  {shareIcon}
                </ActionIcon>
              </Tooltip>
            )}
            {photoDetail && !actionsInMenu && (
              <Tooltip label={trashLabel} position="bottom" withArrow>
                <ActionIcon variant="subtle" color="gray" size={28} aria-label={trashLabel} onClick={toggleTrash}>
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
                  <RotateCCW size={ICON_SIZE.lightbox} />
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
                  <RotateCW size={ICON_SIZE.lightbox} />
                </ActionIcon>
              </Tooltip>
            )}
            {actionsInMenu && (
              // Kept inside the lightbox: a portal would not show in fullscreen.
              <Menu position="bottom-end" withinPortal={false}>
                <Menu.Target>
                  <ActionIcon variant="subtle" color="gray" size={28} aria-label={t("lightbox.toolbar.moreActions")}>
                    <Dots size={ICON_SIZE.lightbox} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  {photoDetail && (
                    <Menu.Item leftSection={hideIcon} onClick={toggleHidden}>
                      {hideLabel}
                    </Menu.Item>
                  )}
                  {photoDetail && (
                    <Menu.Item leftSection={shareIcon} onClick={actions.openShareLink}>
                      {shareLabel}
                    </Menu.Item>
                  )}
                  {photoDetail && (
                    <Menu.Item leftSection={trashIcon} onClick={toggleTrash}>
                      {trashLabel}
                    </Menu.Item>
                  )}
                  {photoDetail && canRotate && (
                    <Menu.Item leftSection={<RotateCCW size={ICON_SIZE.lightbox} />} onClick={() => onRotate(-90)}>
                      {t("lightbox.toolbar.rotateCCW")}
                    </Menu.Item>
                  )}
                  {photoDetail && canRotate && (
                    <Menu.Item leftSection={<RotateCW size={ICON_SIZE.lightbox} />} onClick={() => onRotate(90)}>
                      {t("lightbox.toolbar.rotateCW")}
                    </Menu.Item>
                  )}
                  {onCopyToClipboard && (
                    <Menu.Item leftSection={<Copy size={ICON_SIZE.lightbox} />} onClick={onCopyToClipboard}>
                      {copyLabel}
                    </Menu.Item>
                  )}
                  <Menu.Item
                    leftSection={
                      isFullscreen ? <Minimize size={ICON_SIZE.lightbox} /> : <Maximize size={ICON_SIZE.lightbox} />
                    }
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
      {!isPublic && <PhotoShareLinkModal photoId={actions.sharingPhotoId} onClose={actions.closeShareLink} />}

      {/* Group 4: Panel controls - Info toggle & Close (sidebar toggle right next to X).
          Its divider is not part of group 3, which a public page and a photo
          without details do not have. */}
      <Divider orientation="vertical" color="var(--app-scrim-white-20)" />
      <Group gap={4} align="center">
        <Tooltip label={infoLabel} position="bottom" withArrow>
          <ActionIcon
            variant="subtle"
            color={lightboxSidebarShow ? "blue" : "gray"}
            size={28}
            aria-label={infoLabel}
            onClick={() => setLightBoxSidebarShow(!lightboxSidebarShow)}
          >
            <InfoCircle size={ICON_SIZE.lightbox} />
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
            <X size={ICON_SIZE.lightbox} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
