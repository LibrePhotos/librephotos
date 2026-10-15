import type { PhotoShareLink, PigPhoto, UserAlbumInfo } from "@librephotos/api-client";
import { useDisclosure } from "@mantine/hooks";
import { IconLink } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { DateTime } from "luxon";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserAlbumsQuery } from "../../api_client/albums/hooks";
import { useFetchMyPublicPhotosQuery, useFetchPhotoSharesQuery } from "../../api_client/photos/hooks";
import { parseInstant, parsePhotoTimestamp } from "../../util/dateUtils";
import classes from "../album/AlbumSection.module.css";
import { AlbumShareButton } from "./AlbumShareButton";
import { ModalAlbumShare } from "./ModalAlbumShare";
import { ShareThumbnail } from "./ShareThumbnail";
import overviewClasses from "./SharingOverview.module.css";
import { AlbumPreviewCard, PhotoPreviewCover, SharePreviewInfo, SharingSectionHeading } from "./SharingPreviewCards";
import { itemSummary, SharingPreviewSection } from "./SharingPreviewSection";

const PREVIEW_SIZE = 6;

/** When a photo link was made, relative to now in the UI language ("3 days ago"). */
function shareLinkAge(share: Pick<PhotoShareLink, "created_at">): string {
  return parseInstant(share.created_at).toRelative() ?? "";
}

/**
 * When a public photo was taken, as a date in the UI language. A photo is made public without a
 * timestamp of its own, so its own date is what tells two public photos apart.
 */
function publicPhotoDate(photo: Pick<PigPhoto, "date">): string {
  if (!photo.date) return "";
  const taken = parsePhotoTimestamp(photo.date);
  return taken.isValid ? taken.toLocaleString(DateTime.DATE_MED) : "";
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
        // The wrapper is the 140px card: a plain inline link inside it ignored the card width,
        // so a long title widened the card and pushed the share button off the cover.
        <div key={album.id} className={overviewClasses.albumWithButton}>
          <AlbumPreviewCard album={album} />
          <AlbumShareButton label={t("sidemenu.sharing")} onClick={() => onShareAlbum(album)} />
        </div>
      ))}
      {photoShares.map(share => (
        <Link key={share.slug} to="/sharing/links" search={{ tab: "photos" }} className={classes.albumCard}>
          <div className={classes.albumCover}>
            <ShareThumbnail
              imageHash={share.image_hash}
              size={140}
              kind="square_thumbnails"
              className={classes.albumCoverImage}
            />
          </div>
          <SharePreviewInfo title={t("sharing.photoLink")} detail={shareLinkAge(share)} />
        </Link>
      ))}
      {publicPhotos.map(photo => (
        <Link key={photo.id} to="/sharing/links" search={{ tab: "photos" }} className={classes.albumCard}>
          <PhotoPreviewCover imageHash={photo.id} video={photo.type === "video"} />
          <SharePreviewInfo title={t("sharing.publicPhoto")} detail={publicPhotoDate(photo)} />
        </Link>
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
        heading={
          <Link to="/sharing/links" className={`${classes.headerLeft} ${classes.headerReset}`}>
            <SharingSectionHeading
              icon={<IconLink size={24} stroke={1.5} color="var(--mantine-color-violet-6)" />}
              title={t("sharing.publicLinks")}
              summary={itemSummary(t, photoCount, publicAlbums.length)}
            />
          </Link>
        }
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
