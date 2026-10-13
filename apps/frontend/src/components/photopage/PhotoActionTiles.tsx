import { Media, type Photo } from "@librephotos/api-client";
import { Menu, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconArrowBackUp,
  IconArrowsMaximize,
  IconBookmarkPlus,
  IconCopy,
  IconDotsVertical,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconGlobe,
  IconRotate2,
  IconRotateClockwise2,
  IconStar,
  IconStarFilled,
  IconTrash,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { mediaUrl } from "../../api_client/media/mediaUrl";
import { FAVORITE_COLOR, ICON_SIZE } from "../../uiConstants";
import type { PhotoActions } from "../lightbox/usePhotoActions";
import { getVariantBadgeProps } from "../lightbox/VersionComponent";
import { AlbumEditModal } from "../modals/AlbumEdit/AlbumEditModal";
import { PhotoShareLinkModal } from "../sharing/PhotoShareLinkModal";
import classes from "./PhotoActionTiles.module.css";
import { fileNameOf } from "./photoPageText";

const TILE_ICON = 20;

/** The icon over the label of one tile. */
function TileFace({ icon, label }: Readonly<{ icon: React.ReactNode; label: string }>) {
  return (
    <>
      <span className={classes.icon} aria-hidden>
        {icon}
      </span>
      <span className={classes.label}>{label}</span>
    </>
  );
}

/** Download: the original at once, or a menu with each format when the photo has more than one file. */
function DownloadTile({ photo }: Readonly<{ photo: Photo }>) {
  const { t } = useTranslation();
  const mainPath = photo.image_path[0];
  const mainName = mainPath !== undefined ? fileNameOf(mainPath) : undefined;
  const variants = (photo.file_variants ?? []).filter(variant => !variant.is_main);
  const face = <TileFace icon={<IconDownload size={TILE_ICON} />} label={t("photopage.tiles.download")} />;
  if (variants.length === 0) {
    return (
      <UnstyledButton
        component="a"
        href={mediaUrl.photo(photo.image_hash)}
        download={mainName}
        className={classes.tile}
      >
        {face}
      </UnstyledButton>
    );
  }
  return (
    <Menu position="bottom-end">
      <Menu.Target>
        <UnstyledButton className={classes.tile}>{face}</UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item component="a" href={mediaUrl.photo(photo.image_hash)} download={mainName}>
          {t("photopage.download.original", { name: mainName ?? t("photopage.unknownfilename") })}
        </Menu.Item>
        {variants.map(variant => {
          const name = variant.filename || fileNameOf(variant.path);
          return (
            <Menu.Item key={variant.hash} component="a" href={mediaUrl.photo(variant.hash)} download={name}>
              {t("photopage.download.format", { format: getVariantBadgeProps(variant).label, name })}
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );
}

type Props = Readonly<{
  photo: Photo;
  actions: PhotoActions;
  /** Absent for a video: the server does not rotate one. */
  onRotate?: (angle: number) => void;
  /** Absent where the browser has no image clipboard, and for a video. */
  onCopy?: () => void;
  onOpenViewer: () => void;
}>;

/**
 * The owner's actions on the photo as labelled tiles (Favorite, Share, Album,
 * Download, More), so none hides behind an unlabelled icon. More holds the
 * rest of the lightbox's toolbar: copy, rotate, hide, the viewer and trash.
 */
export function PhotoActionTiles({ photo, actions, onRotate, onCopy, onOpenViewer }: Props) {
  const { t } = useTranslation();
  const [albumOpened, { open: openAlbum, close: closeAlbum }] = useDisclosure(false);
  const albumItem = { id: photo.id, image_hash: photo.image_hash, type: photo.video ? Media.VIDEO : Media.IMAGE };

  return (
    <div className={classes.tiles} role="group" aria-label={t("photopage.tiles.label")}>
      <UnstyledButton
        className={classes.tile}
        data-active={actions.isFavorite || undefined}
        aria-pressed={actions.isFavorite}
        title={actions.isFavorite ? t("photopage.actions.unfavorite") : t("photopage.actions.favorite")}
        onClick={actions.toggleFavorite}
      >
        <TileFace
          icon={
            actions.isFavorite ? (
              <IconStarFilled size={TILE_ICON} color={FAVORITE_COLOR} />
            ) : (
              <IconStar size={TILE_ICON} />
            )
          }
          label={t("photopage.tiles.favorite")}
        />
      </UnstyledButton>
      <UnstyledButton
        className={classes.tile}
        data-shared={actions.isShared || undefined}
        title={t("photopage.actions.share")}
        onClick={actions.openShareLink}
      >
        <TileFace icon={<IconGlobe size={TILE_ICON} />} label={t("photopage.tiles.share")} />
      </UnstyledButton>
      <UnstyledButton className={classes.tile} title={t("photopage.tiles.albumhint")} onClick={openAlbum}>
        <TileFace icon={<IconBookmarkPlus size={TILE_ICON} />} label={t("photopage.tiles.album")} />
      </UnstyledButton>
      <DownloadTile photo={photo} />
      <Menu position="bottom-end">
        <Menu.Target>
          <UnstyledButton className={classes.tile}>
            <TileFace icon={<IconDotsVertical size={TILE_ICON} />} label={t("photopage.tiles.more")} />
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          {onCopy && (
            <Menu.Item leftSection={<IconCopy size={ICON_SIZE.menu} />} onClick={onCopy}>
              {t("photopage.more.copy")}
            </Menu.Item>
          )}
          {onRotate && (
            <Menu.Item leftSection={<IconRotate2 size={ICON_SIZE.menu} />} onClick={() => onRotate(-90)}>
              {t("lightbox.toolbar.rotateCCW")}
            </Menu.Item>
          )}
          {onRotate && (
            <Menu.Item leftSection={<IconRotateClockwise2 size={ICON_SIZE.menu} />} onClick={() => onRotate(90)}>
              {t("lightbox.toolbar.rotateCW")}
            </Menu.Item>
          )}
          <Menu.Item
            leftSection={actions.isHidden ? <IconEyeOff size={ICON_SIZE.menu} /> : <IconEye size={ICON_SIZE.menu} />}
            onClick={actions.toggleHidden}
          >
            {actions.isHidden ? t("photopage.actions.show") : t("photopage.actions.hide")}
          </Menu.Item>
          <Menu.Item leftSection={<IconArrowsMaximize size={ICON_SIZE.menu} />} onClick={onOpenViewer}>
            {t("photopage.openinviewer")}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            color={actions.inTrash ? undefined : "red"}
            leftSection={
              actions.inTrash ? <IconArrowBackUp size={ICON_SIZE.menu} /> : <IconTrash size={ICON_SIZE.menu} />
            }
            onClick={actions.toggleTrash}
          >
            {actions.inTrash ? t("photopage.actions.restore") : t("photopage.actions.trash")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <PhotoShareLinkModal photoId={actions.sharingPhotoId} onClose={actions.closeShareLink} />
      <AlbumEditModal isOpen={albumOpened} onRequestClose={closeAlbum} selectedImages={[albumItem]} />
    </div>
  );
}
