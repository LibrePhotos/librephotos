import type { PigPhoto, UserAlbumInfo } from "@librephotos/api-client";
import { Avatar, Skeleton, Text } from "@mantine/core";
import { IconDownload, IconUpload, IconWorld } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedAlbumsByMeQuery, useFetchSharedAlbumsWithMeQuery } from "../../api_client/albums/hooks";
import { useFetchSharedPhotosByMeQuery, useFetchSharedPhotosWithMeQuery } from "../../api_client/photos/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import classes from "../album/AlbumSection.module.css";
import { avatarSrc } from "./avatarSrc";
import overviewClasses from "./SharingOverview.module.css";
import { AlbumPreviewCard, PhotoPreviewCover, SharingSectionHeading } from "./SharingPreviewCards";
import { itemSummary, SharingPreviewSection } from "./SharingPreviewSection";

/** The Sharing overview's sections above Public Links (routes/_protected/sharing/index.tsx). */

const HEADING_LINK = `${classes.headerLeft} ${classes.headerReset}`;
const PREVIEW_SIZE = 6;
const PUBLIC_USERS_SHOWN = 14;

function AvatarSkeleton() {
  return (
    <div className={classes.avatarGridLoading}>
      {[1, 2, 3, 4, 5, 6].map(i => (
        <div key={i} className={overviewClasses.avatarSkeleton}>
          <Skeleton height={56} width={56} circle />
          <Skeleton height={10} width={50} mt={4} />
        </div>
      ))}
    </div>
  );
}

/** The users on this instance who made their photos public, as avatars linking to their pages. */
export function PublicUsersSection() {
  const { t } = useTranslation();
  const { data: users, isLoading } = useFetchUserListQuery();
  const publicUsers = (users ?? []).filter(user => user.public_sharing);
  return (
    <SharingPreviewSection
      heading={
        <Link to="/sharing/public" className={HEADING_LINK}>
          <SharingSectionHeading
            icon={<IconWorld size={24} stroke={1.5} />}
            title={t("sidemenu.publicphotos")}
            summary={t("sharing.userCount", { count: publicUsers.length })}
          />
        </Link>
      }
      loading={isLoading}
      emptyText={publicUsers.length === 0 ? t("sharing.noPublicUsers") : null}
      skeleton={<AvatarSkeleton />}
    >
      <div className={classes.avatarGrid}>
        {publicUsers.slice(0, PUBLIC_USERS_SHOWN).map(user => {
          const displayName =
            user.first_name && user.last_name ? `${user.first_name} ${user.last_name}` : user.username;
          return (
            <Link key={user.id} to="/public/$users" params={{ users: user.username }} className={classes.avatarItem}>
              <div className={classes.avatar}>
                <Avatar size={52} radius="xl" src={avatarSrc(user)}>
                  {displayName.charAt(0).toUpperCase()}
                </Avatar>
              </div>
              <Text className={classes.avatarName} title={displayName}>
                {displayName}
              </Text>
            </Link>
          );
        })}
      </div>
    </SharingPreviewSection>
  );
}

type PreviewAlbum = Pick<UserAlbumInfo, "id" | "title" | "photo_count" | "cover_photo">;

type RowProps = Readonly<{
  photos: readonly Pick<PigPhoto, "id" | "type">[];
  albums: readonly PreviewAlbum[];
  /** Each photo card's link to the section's photo tab. */
  photoLink: (photoId: string, cover: ReactNode) => ReactNode;
}>;

/** The first photos, then the first albums, of a "shared with you" or "you shared" section. */
function SharedPreviewRow({ photos, albums, photoLink }: RowProps) {
  return (
    <div className={classes.scrollContainer}>
      {photos
        .slice(0, PREVIEW_SIZE)
        .map(photo => photoLink(photo.id, <PhotoPreviewCover imageHash={photo.id} video={photo.type === "video"} />))}
      {albums.slice(0, PREVIEW_SIZE).map(album => (
        <AlbumPreviewCard key={album.id} album={album} />
      ))}
    </div>
  );
}

type Grouped = Readonly<{
  photos: readonly (readonly Pick<PigPhoto, "id" | "type">[])[];
  albums: readonly (readonly PreviewAlbum[])[];
}>;

/** What a section counts and previews, from the lists grouped per user. */
function sharedItems({ photos, albums }: Grouped) {
  const flatPhotos = photos.flat();
  const flatAlbums = albums.flat();
  return {
    photos: flatPhotos,
    albums: flatAlbums,
    // Grouped per user: count what was shared once, however many users it went to or came from.
    photoCount: new Set(flatPhotos.map(photo => photo.id)).size,
    albumCount: new Set(flatAlbums.map(album => album.id)).size,
  };
}

/** Photos and albums other users shared with you. */
export function SharedWithYouSection() {
  const { t } = useTranslation();
  const photosQuery = useFetchSharedPhotosWithMeQuery();
  const albumsQuery = useFetchSharedAlbumsWithMeQuery();
  const items = sharedItems({
    photos: (photosQuery.data ?? []).map(group => group.photos),
    albums: (albumsQuery.data ?? []).map(group => group.albums),
  });
  return (
    <SharingPreviewSection
      heading={
        <Link to="/sharing/withme/$tab" params={{ tab: "photos" }} className={HEADING_LINK}>
          <SharingSectionHeading
            icon={<IconDownload size={24} stroke={1.5} color="var(--mantine-color-green-6)" />}
            title={t("sidemenu.sharedwithyou")}
            summary={itemSummary(t, items.photoCount, items.albumCount)}
          />
        </Link>
      }
      // Until both answer: one empty list alone said "nothing shared yet".
      loading={photosQuery.isLoading || albumsQuery.isLoading}
      emptyText={items.photos.length + items.albums.length === 0 ? t("sharing.nothingSharedWithYou") : null}
    >
      <SharedPreviewRow
        photos={items.photos}
        albums={items.albums}
        photoLink={(id, cover) => (
          <Link key={id} to="/sharing/withme/$tab" params={{ tab: "photos" }} className={classes.albumCard}>
            {cover}
          </Link>
        )}
      />
    </SharingPreviewSection>
  );
}

/** Photos and albums you shared with other users. */
export function YouSharedSection() {
  const { t } = useTranslation();
  const photosQuery = useFetchSharedPhotosByMeQuery();
  const albumsQuery = useFetchSharedAlbumsByMeQuery();
  const items = sharedItems({
    photos: (photosQuery.data ?? []).map(group => group.photos),
    albums: (albumsQuery.data ?? []).map(group => group.albums),
  });
  return (
    <SharingPreviewSection
      heading={
        <Link to="/sharing/byme/$tab" params={{ tab: "photos" }} className={HEADING_LINK}>
          <SharingSectionHeading
            icon={<IconUpload size={24} stroke={1.5} color="var(--mantine-color-red-6)" />}
            title={t("sidemenu.youshared")}
            summary={itemSummary(t, items.photoCount, items.albumCount)}
          />
        </Link>
      }
      loading={photosQuery.isLoading || albumsQuery.isLoading}
      emptyText={items.photos.length + items.albums.length === 0 ? t("sharing.nothingSharedByYou") : null}
    >
      <SharedPreviewRow
        photos={items.photos}
        albums={items.albums}
        photoLink={(id, cover) => (
          <Link key={id} to="/sharing/byme/$tab" params={{ tab: "photos" }} className={classes.albumCard}>
            {cover}
          </Link>
        )}
      />
    </SharingPreviewSection>
  );
}
