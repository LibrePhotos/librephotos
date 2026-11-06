import type { Photo } from "@librephotos/api-client";
import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconCopy as Copy,
  IconDotsVertical as Dots,
  IconArrowsMaximize as Maximize,
  IconArrowsMinimize as Minimize,
  IconPlayerPause as Pause,
  IconPlayerPlay as Play,
  IconArrowBackUp as Restore,
  IconRotate2 as RotateCCW,
  IconRotateClockwise2 as RotateCW,
  IconShare as Share,
  IconTrash as Trash,
  IconZoomIn as ZoomIn,
  IconZoomOut as ZoomOut,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { FileActionItems } from "../photolist/FileActionItems";
import { LightboxToolbarButton, TOOLBAR_BUTTON, TOOLBAR_ICON_SIZE } from "./LightboxToolbarButton";
import { VisibilityMenuItems } from "./LightboxVisibilityActions";
import type { PhotoActions } from "./usePhotoActions";

/** Move to the trash, or restore a photo that is already there (D). */
export function TrashButton({ actions }: Readonly<{ actions: PhotoActions }>) {
  const { t } = useTranslation();
  return actions.inTrash ? (
    <LightboxToolbarButton label={t("lightbox.toolbar.restorePhoto")} onClick={actions.toggleTrash}>
      <Restore size={TOOLBAR_ICON_SIZE} />
    </LightboxToolbarButton>
  ) : (
    <LightboxToolbarButton label={t("lightbox.toolbar.deletePhoto")} onClick={actions.toggleTrash}>
      <Trash size={TOOLBAR_ICON_SIZE} />
    </LightboxToolbarButton>
  );
}

/** The owner's share link (P): the first of the toolbar's buttons, as in Google Photos and Immich. */
export function ShareButton({ actions }: Readonly<{ actions: PhotoActions }>) {
  const { t } = useTranslation();
  return (
    <LightboxToolbarButton label={t("sharing.shareLinkShortcut")} onClick={actions.openShareLink}>
      <Share size={TOOLBAR_ICON_SIZE} color={actions.isShared ? "var(--mantine-color-green-4)" : undefined} />
    </LightboxToolbarButton>
  );
}

type MenuItemProps = Readonly<{ label: string; icon: React.ReactNode; onClick: () => void }>;

/** Zoom of a still photo, in the ⋮ (Z and a double click on the photo do the same). */
type ZoomItem = Readonly<{
  isZoomed: boolean;
  toggle: () => void;
  /** Why it does nothing now (the 360° view zooms itself); false when it works. */
  blockedReason: string | false;
}>;

type MoreMenuProps = Readonly<{
  actions: PhotoActions;
  /** Absent for a video and anything else that does not zoom. */
  zoom?: ZoomItem;
  /** The viewer's own photo with its details loaded, whose actions join the menu; else null. */
  ownPhoto: Photo | null;
  /** The server refuses to rotate a video, and the player would not show it. */
  canRotate: boolean;
  onRotate: (angle: number) => void;
  slideshowLabel: string;
  isSlideshowActive: boolean;
  toggleSlideshow: () => void;
  /** Absent where copy cannot work (a video, a page without an image clipboard). */
  onCopyToClipboard?: () => void;
  copyLabel: string;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  fullscreenLabel: string;
}>;

/** The two rotations of the owner's photo (hide and archive are VisibilityMenuItems). */
function useRotationItems({ canRotate, onRotate }: MoreMenuProps): MenuItemProps[] {
  const { t } = useTranslation();
  return canRotate
    ? [
        {
          label: t("lightbox.toolbar.rotateCCW"),
          icon: <RotateCCW size={ICON_SIZE.lightbox} />,
          onClick: () => onRotate(-90),
        },
        {
          label: t("lightbox.toolbar.rotateCW"),
          icon: <RotateCW size={ICON_SIZE.lightbox} />,
          onClick: () => onRotate(90),
        },
      ]
    : [];
}

/**
 * The toolbar's ⋮: what is used less often, with labels. Zoom, the slideshow, copy and fullscreen
 * for everyone; for the owner's photo also hide, archive, the rotations and the file actions
 * (rescan, faces). Their shortcuts (Z, S, Ctrl+C, G, H, A) work with the menu closed.
 */
export function LightboxMoreMenu(props: MoreMenuProps) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  const { actions, ownPhoto, isSlideshowActive, toggleSlideshow, slideshowLabel, zoom } = props;
  const { onCopyToClipboard, copyLabel, isFullscreen, toggleFullscreen, fullscreenLabel } = props;
  const photoItems = useRotationItems(props);
  const zoomLabel = zoom?.isZoomed ? t("lightbox.controls.zoomout") : t("lightbox.controls.zoomin");
  const label = t("lightbox.toolbar.moreActions");
  return (
    // Kept inside the lightbox: a portal would not show in fullscreen.
    <Menu
      position="bottom-end"
      withinPortal={false}
      width={260}
      opened={opened}
      onChange={next => (next ? open() : close())}
    >
      <Menu.Target>
        {/* Hidden while the menu is open: it would sit over the first item. */}
        <Tooltip label={label} position="bottom" withArrow disabled={opened}>
          <ActionIcon {...TOOLBAR_BUTTON} aria-label={label}>
            <Dots size={TOOLBAR_ICON_SIZE} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {zoom && (
          <DisabledReason reason={zoom.blockedReason} position="left">
            <Menu.Item
              leftSection={zoom.isZoomed ? <ZoomOut size={ICON_SIZE.lightbox} /> : <ZoomIn size={ICON_SIZE.lightbox} />}
              onClick={zoom.toggle}
            >
              {zoomLabel}
            </Menu.Item>
          </DisabledReason>
        )}
        <Menu.Item
          leftSection={isSlideshowActive ? <Pause size={ICON_SIZE.lightbox} /> : <Play size={ICON_SIZE.lightbox} />}
          onClick={toggleSlideshow}
        >
          {slideshowLabel}
        </Menu.Item>
        {onCopyToClipboard && (
          <Menu.Item leftSection={<Copy size={ICON_SIZE.lightbox} />} onClick={onCopyToClipboard}>
            {copyLabel}
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={isFullscreen ? <Minimize size={ICON_SIZE.lightbox} /> : <Maximize size={ICON_SIZE.lightbox} />}
          onClick={toggleFullscreen}
        >
          {fullscreenLabel}
        </Menu.Item>
        {ownPhoto && (
          <>
            <Menu.Divider />
            <VisibilityMenuItems actions={actions} />
            {photoItems.map(({ label: itemLabel, icon, onClick }) => (
              <Menu.Item key={itemLabel} leftSection={icon} onClick={onClick}>
                {itemLabel}
              </Menu.Item>
            ))}
          </>
        )}
        {ownPhoto && actions.isOwner && (
          <>
            <Menu.Divider />
            <FileActionItems photoIds={[ownPhoto.id]} single iconSize={ICON_SIZE.lightbox} />
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
