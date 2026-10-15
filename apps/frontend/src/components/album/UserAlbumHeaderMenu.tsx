import type { PigPhoto, UserAlbum } from "@librephotos/api-client";
import { Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconCloudUpload,
  IconEdit,
  IconFolders,
  IconLock,
  IconLockOpen,
  IconPhoto,
  IconShare,
  IconTrash,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  useFetchUserAlbumsQuery,
  useSetUserAlbumCoverMutation,
  useToggleUserAlbumLockedMutation,
} from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
import { AlbumCoverPickerModal } from "../modals/AlbumCoverPickerModal";
import { HeaderActionsMenu } from "../photolist/HeaderActionsMenu";
import { ModalAlbumShare } from "../sharing/ModalAlbumShare";
import type { AlbumUpload } from "../upload/useAlbumUpload";
import { AlbumCollectionsModal } from "./AlbumCollectionsModal";
import { DeleteUserAlbumModal, RenameUserAlbumModal } from "./UserAlbumModals";

type Props = Readonly<{
  album: Pick<UserAlbum, "id" | "title" | "locked" | "owner" | "collection_ids">;
  /** Upload into this album (#612); absent when uploads are off. */
  upload?: AlbumUpload | null;
  /** The album's photos, to pick the cover from. */
  photos: PigPhoto[];
}>;

/**
 * The owner's "⋮" on an album page (#2208): Upload to this album (#612), then the My Albums
 * card's Rename, Set as cover (any photo, no selection needed, #2240), Sharing, Collections
 * (#1009), Lock / Unlock and Delete, where deleting goes back to My Albums.
 */
export function UserAlbumHeaderMenu({ album, upload, photos }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [renameOpened, rename] = useDisclosure(false);
  const [coverOpened, cover] = useDisclosure(false);
  const [shareOpened, share] = useDisclosure(false);
  const [collectionsOpened, collections] = useDisclosure(false);
  const [deleteOpened, remove] = useDisclosure(false);
  // The other titles, for the rename's duplicate check; usually cached from My Albums.
  const { data: albums } = useFetchUserAlbumsQuery();
  const toggleLocked = useToggleUserAlbumLockedMutation();
  const setCover = useSetUserAlbumCoverMutation();
  const albumId = String(album.id);

  const closeAndFocus = (close: () => void) => () => {
    close();
    trigger.current?.focus();
  };

  return (
    <>
      <HeaderActionsMenu label={t("useralbum.albumActions")} triggerRef={trigger}>
        {upload && (
          <>
            <DisabledReason reason={upload.reason} position="left">
              <Menu.Item leftSection={<IconCloudUpload size={ICON_SIZE.menu} />} onClick={upload.open}>
                {t("upload.album.menu")}
              </Menu.Item>
            </DisabledReason>
            <Menu.Divider />
          </>
        )}
        <Menu.Item leftSection={<IconEdit size={ICON_SIZE.menu} />} onClick={rename.open}>
          {t("rename")}
        </Menu.Item>
        <Menu.Item leftSection={<IconPhoto size={ICON_SIZE.menu} />} onClick={cover.open}>
          {t("modalalbumcover.menuitem")}
        </Menu.Item>
        <Menu.Item leftSection={<IconShare size={ICON_SIZE.menu} />} onClick={share.open}>
          {t("sidemenu.sharing")}
        </Menu.Item>
        <Menu.Item leftSection={<IconFolders size={ICON_SIZE.menu} />} onClick={collections.open}>
          {t("albumcollections.menuitem")}
        </Menu.Item>
        <Menu.Item
          leftSection={album.locked ? <IconLockOpen size={ICON_SIZE.menu} /> : <IconLock size={ICON_SIZE.menu} />}
          onClick={() => toggleLocked.mutate({ id: albumId, locked: !album.locked })}
        >
          {t(album.locked ? "useralbum.unlockAlbum" : "useralbum.lockAlbum")}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconTrash size={ICON_SIZE.menu} />} onClick={remove.open}>
          {t("useralbum.deletealbum")}
        </Menu.Item>
      </HeaderActionsMenu>
      <RenameUserAlbumModal
        opened={renameOpened}
        onClose={closeAndFocus(rename.close)}
        albumId={albumId}
        albumTitle={album.title}
        // A new spelling of its own title is not a clash
        existingTitles={(albums ?? []).filter(other => String(other.id) !== albumId).map(other => other.title)}
      />
      <AlbumCoverPickerModal
        isOpen={coverOpened}
        onRequestClose={closeAndFocus(cover.close)}
        // Placeholders of photos that have not loaded have no picture to pick
        photos={photos.filter(photo => !photo.isTemp)}
        albumTitle={album.title}
        onSelectCover={photo => setCover.mutate({ id: albumId, photo })}
      />
      <ModalAlbumShare
        isOpen={shareOpened}
        onRequestClose={closeAndFocus(share.close)}
        albumID={albumId}
        ownerUsername={album.owner.username}
      />
      <AlbumCollectionsModal
        opened={collectionsOpened}
        onClose={closeAndFocus(collections.close)}
        albumId={albumId}
        albumTitle={album.title}
        collectionIds={album.collection_ids}
      />
      <DeleteUserAlbumModal
        opened={deleteOpened}
        onClose={closeAndFocus(remove.close)}
        albumId={albumId}
        albumTitle={album.title}
        onDeleted={() => void navigate({ to: "/album/user" })}
      />
    </>
  );
}
