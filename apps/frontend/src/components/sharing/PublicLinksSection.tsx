import type { PhotoShareLink, PigPhoto, UserAlbumInfo } from "@librephotos/api-client";
import { Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLink, IconShare } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserAlbumsQuery } from "../../api_client/albums/hooks";
import { useFetchMyPublicPhotosQuery, useFetchPhotoSharesQuery } from "../../api_client/photos/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { parseInstant } from "../../util/dateUtils";
import { ROW_CARD_SIZE } from "../album/AlbumSection";
import classes from "../album/AlbumSection.module.css";
import { collectionCardImageClass } from "../common/CollectionCard";
import { MediaThumbnail } from "../common/MediaThumbnail";
import { Tile } from "../Tile";
import { ModalAlbumShare } from "./ModalAlbumShare";
import { AlbumPreviewCard, PhotoLinkCard, photoTakenDate } from "./SharingPreviewCards";
import { itemSummary, SharingPreviewSection } from "./SharingPreviewSection";

const PREVIEW_SIZE = 6;

/** When a photo link was made, relative to now in the UI language ("3 days ago"). */
function shareLinkAge(share: Pick<PhotoShareLink, "created_at">): string {
  return parseInstant(share.created_at).toRelative() ?? "";
}

type RowProps = Readonly<{
  albums: readonly UserAlbumInfo[];
  photoShares: readonly PhotoShareLink[];
  publicPhotos: readonly PigPhoto[];
  onShareAlbum: (album: UserAlbumInfo) => void;
}>;

/**
 * Public albums with their share button, then photo share links and public photos. Every card has
 * a caption like the album cards (#2241), so the row has one height and a photo card says what
 * kind of link it is.
 */
function PublicLinksRow({ albums, photoShares, publicPhotos, onShareAlbum }: RowProps) {
  const { t } = useTranslation();
  return (
    <div className={classes.scrollContainer}>
      {albums.map(album => (
        <AlbumPreviewCard
          key={album.id}
          album={album}
          menuItems={
            <Menu.Item leftSection={<IconShare size={ICON_SIZE.menu} />} onClick={() => onShareAlbum(album)}>
              {t("sidemenu.sharing")}
            </Menu.Item>
          }
        />
      ))}
      {photoShares.map(share => (
        <PhotoLinkCard
          key={share.slug}
          title={t("sharing.photoLink")}
          detail={shareLinkAge(share)}
          media={
            <MediaThumbnail
              imageHash={share.image_hash}
              size={ROW_CARD_SIZE}
              kind="square_thumbnails"
              radius={0}
              className={collectionCardImageClass}
            />
          }
        />
      ))}
      {publicPhotos.map(photo => (
        <PhotoLinkCard
          key={photo.id}
          title={t("sharing.publicPhoto")}
          detail={photoTakenDate(photo)}
          media={
            <Tile
              video={photo.type === "video"}
              width={ROW_CARD_SIZE}
              height={ROW_CARD_SIZE}
              image_hash={photo.id}
              className={collectionCardImageClass}
            />
          }
        />
      ))}
    </div>
  );
}

/** The Sharing overview's Public Links: albums with a public link, photo share links and public photos. */
export function PublicLinksSection() {
  const { t } = useTranslation();
  const [sharedAlbum, setSharedAlbum] = useState<UserAlbumInfo | null>(null);
  const [isShareDialogOpen, shareDialog] = useDisclosure(false);

  const { data: userAlbums, isLoading: isLoadingUserAlbums } = useFetchUserAlbumsQuery();
  // The latest few of my public photos and how many there are, straight from the server: the
  // public day list holds placeholders until a day's page loads, so it showed and counted none (#2686).
  const { data: publicPhotosPage, isLoading: isLoadingPublicPhotos } = useFetchMyPublicPhotosQuery(PREVIEW_SIZE);
  // Per-photo share links are public links too; the Public Links page lists them.
  const { data: photoShares, isLoading: isLoadingPhotoShares } = useFetchPhotoSharesQuery();

  const publicAlbums = useMemo(() => (userAlbums ?? []).filter(album => album.public), [userAlbums]);
  const publicPhotos = publicPhotosPage?.results ?? [];
  const shares = photoShares ?? [];
  const photoCount = (publicPhotosPage?.count ?? 0) + shares.length;

  return (
    <>
      <SharingPreviewSection
        icon={<IconLink size={24} stroke={1.5} color="var(--mantine-color-dimmed)" />}
        title={t("sharing.publicLinks")}
        summary={itemSummary(t, photoCount, publicAlbums.length)}
        renderLink={props => <Link to="/sharing/links" {...props} />}
        loading={isLoadingUserAlbums || isLoadingPublicPhotos || isLoadingPhotoShares}
        emptyText={photoCount + publicAlbums.length === 0 ? t("sharing.noPublicLinks") : null}
      >
        <PublicLinksRow
          albums={publicAlbums.slice(0, PREVIEW_SIZE)}
          photoShares={shares.filter(share => share.image_hash).slice(0, PREVIEW_SIZE)}
          publicPhotos={publicPhotos.slice(0, PREVIEW_SIZE)}
          onShareAlbum={album => {
            setSharedAlbum(album);
            shareDialog.open();
          }}
        />
      </SharingPreviewSection>
      {/* Outside the section: making the last album private empties it while the dialog is open */}
      <ModalAlbumShare
        isOpen={isShareDialogOpen}
        onRequestClose={shareDialog.close}
        albumID={sharedAlbum ? `${sharedAlbum.id}` : ""}
        ownerUsername={sharedAlbum?.owner.username ?? ""}
      />
    </>
  );
}
