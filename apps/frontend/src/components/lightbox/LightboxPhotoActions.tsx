import type { Photo } from "@librephotos/api-client";
import { ActionIcon, Divider, Group, Loader, Menu, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconCopy as Copy,
  IconDotsVertical as Dots,
  IconGlobe as Globe,
  IconArrowsMaximize as Maximize,
  IconArrowsMinimize as Minimize,
  IconArrowBackUp as Restore,
  IconRotate2 as RotateCCW,
  IconRotateClockwise2 as RotateCW,
  IconTrash as Trash,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { FileActionItems } from "../photolist/FileActionItems";
import { LightboxRating } from "./LightboxRating";
import { VisibilityButtons, VisibilityMenuItems } from "./LightboxVisibilityActions";
import type { PhotoActions } from "./usePhotoActions";

type Props = Readonly<{
  actions: PhotoActions;
  photoDetail: Photo | null | undefined;
  isPhotoDetailsLoading: boolean;
  /** A phone: the actions, copy and fullscreen go into one menu. */
  actionsInMenu: boolean;
  /** The server refuses to rotate a video, and the player would not show it. */
  canRotate: boolean;
  onRotate: (angle: number) => void;
  onCopyToClipboard?: () => void;
  copyLabel: string;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  fullscreenLabel: string;
}>;

type ToolbarButtonProps = Readonly<{ label: string; icon: React.ReactNode; onClick: () => void }>;

function ToolbarButton({ label, icon, onClick }: ToolbarButtonProps) {
  return (
    <Tooltip label={label} position="bottom" withArrow>
      <ActionIcon variant="subtle" color="gray" size={28} aria-label={label} onClick={onClick}>
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}

/** Share link, trash and the two rotations: buttons in the row, or items of the phone's menu. */
function useRowActions({ actions, canRotate, onRotate }: Pick<Props, "actions" | "canRotate" | "onRotate">) {
  const { t } = useTranslation();
  const share: ToolbarButtonProps = {
    label: t("sharing.shareLinkShortcut"),
    icon: <Globe size={ICON_SIZE.lightbox} color={actions.isShared ? "var(--mantine-color-green-6)" : undefined} />,
    onClick: actions.openShareLink,
  };
  const trash: ToolbarButtonProps = actions.inTrash
    ? {
        label: t("lightbox.toolbar.restorePhoto"),
        icon: <Restore size={ICON_SIZE.lightbox} />,
        onClick: actions.toggleTrash,
      }
    : {
        label: t("lightbox.toolbar.deletePhoto"),
        icon: <Trash size={ICON_SIZE.lightbox} />,
        onClick: actions.toggleTrash,
      };
  const rotations: ToolbarButtonProps[] = canRotate
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
  return { share, trash, rotations };
}

/** The phone's ⋮ menu: the photo's actions, then copy and fullscreen. */
function PhotoActionsMenu(props: Props) {
  const { t } = useTranslation();
  const { actions, photoDetail, onCopyToClipboard, copyLabel, isFullscreen, toggleFullscreen, fullscreenLabel } = props;
  const { share, trash, rotations } = useRowActions(props);
  const photoItems = photoDetail ? [share, trash, ...rotations] : [];
  return (
    // Kept inside the lightbox: a portal would not show in fullscreen.
    <Menu position="bottom-end" withinPortal={false}>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size={28} aria-label={t("lightbox.toolbar.moreActions")}>
          <Dots size={ICON_SIZE.lightbox} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {photoDetail && <VisibilityMenuItems actions={actions} />}
        {photoItems.map(({ label, icon, onClick }) => (
          <Menu.Item key={label} leftSection={icon} onClick={onClick}>
            {label}
          </Menu.Item>
        ))}
        {photoDetail && actions.isOwner && (
          <>
            <Menu.Divider />
            <FileActionItems photoIds={[photoDetail.id]} single iconSize={ICON_SIZE.lightbox} />
            <Menu.Divider />
          </>
        )}
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
      </Menu.Dropdown>
    </Menu>
  );
}

/** The desktop row's ⋮ after rotate: the owner's file actions (rescan, faces), kept out of the row. */
function MoreActionsMenu({ photoId }: Readonly<{ photoId: string }>) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
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
          <ActionIcon variant="subtle" color="gray" size={28} aria-label={label}>
            <Dots size={ICON_SIZE.lightbox} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <FileActionItems photoIds={[photoId]} single iconSize={ICON_SIZE.lightbox} />
      </Menu.Dropdown>
    </Menu>
  );
}

/** The row's buttons for a photo whose details have loaded: hide, archive, rating, share, trash, rotate, ⋮. */
function PhotoActionButtons(props: Props) {
  const { actions, isPhotoDetailsLoading, photoDetail } = props;
  const { share, trash, rotations } = useRowActions(props);
  return (
    <>
      {!isPhotoDetailsLoading && <VisibilityButtons actions={actions} />}
      <LightboxRating actions={actions} />
      {[share, trash, ...rotations].map(button => (
        <ToolbarButton key={button.label} {...button} />
      ))}
      {photoDetail && actions.isOwner && <MoreActionsMenu photoId={photoDetail.id} />}
    </>
  );
}

/**
 * Group 3 of the lightbox toolbar, for the owner: the photo's actions (hide, archive, favorite or
 * stars, share link, trash, rotate), in the row on a wide screen and in a ⋮ menu on a phone, where
 * only the rating stays in the row.
 */
export function LightboxPhotoActions(props: Props) {
  const { actions, photoDetail, isPhotoDetailsLoading, actionsInMenu } = props;
  return (
    <>
      <Divider orientation="vertical" color="var(--app-scrim-white-20)" />
      <Group gap={4} align="center">
        {isPhotoDetailsLoading && (
          // Not a button: nothing to press while the details load. mx keeps the 28px slot.
          <Loader size={ICON_SIZE.inline} color="grey" mx={6} />
        )}
        {photoDetail && !actionsInMenu && <PhotoActionButtons {...props} />}
        {photoDetail && actionsInMenu && <LightboxRating actions={actions} />}
        {actionsInMenu && <PhotoActionsMenu {...props} />}
      </Group>
    </>
  );
}
