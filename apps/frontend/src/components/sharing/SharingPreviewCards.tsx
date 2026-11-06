import type { UserAlbumInfo } from "@librephotos/api-client";
import { Group, Skeleton, Text, Title } from "@mantine/core";
import { IconChevronRight, IconPhoto } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ROW_CARD_SIZE } from "../album/AlbumSection";
import classes from "../album/AlbumSection.module.css";
import { CollectionCard } from "../common/CollectionCard";
import { Tile } from "../Tile";

/** The building blocks of the Sharing overview's preview rows (routes/_protected/sharing/index.tsx). */

type HeadingProps = Readonly<{ icon: ReactNode; title: string; summary: string }>;

/** A section's icon, title and "N photos, M albums · View all", inside the link to its page. */
export function SharingSectionHeading({ icon, title, summary }: HeadingProps) {
  const { t } = useTranslation();
  return (
    <>
      {icon}
      <div>
        <Title order={4}>{title}</Title>
        <Group gap={6}>
          <Text size="sm" c="dimmed">
            {summary}
          </Text>
          <Text size="sm" c="dimmed">
            ·
          </Text>
          <Text size="sm" c="blue">
            {t("explore.viewAll")}
          </Text>
          <IconChevronRight size={14} color="var(--mantine-color-blue-6)" />
        </Group>
      </div>
    </>
  );
}

/** A row of card placeholders while a section loads. */
export function SharePreviewSkeleton() {
  return (
    <div className={classes.loadingContainer}>
      {[1, 2, 3, 4, 5].map(i => (
        <Skeleton key={i} className={classes.skeleton} radius={12} />
      ))}
    </div>
  );
}

type PhotoCoverProps = Readonly<{ imageHash: string; video: boolean }>;

/** A photo's square cover in a preview row, with the collection cards' size and corners. */
export function PhotoPreviewCover({ imageHash, video }: PhotoCoverProps) {
  return (
    <div className={classes.albumCover}>
      <Tile
        video={video}
        width={ROW_CARD_SIZE}
        height={ROW_CARD_SIZE}
        image_hash={imageHash}
        className={classes.albumCoverImage}
      />
    </div>
  );
}

type PhotoCardProps = Readonly<{
  /** What kind of link it is: "Photo link", "Public photo". */
  title: string;
  /** Its age or date; may be empty. */
  detail: string;
  /** The photo, drawn with `collectionCardImageClass`. */
  media: ReactNode;
}>;

/** A photo with a caption in the Public Links row, opening the photo links page. */
export function PhotoLinkCard({ title, detail, media }: PhotoCardProps) {
  return (
    <CollectionCard
      className={classes.rowCard}
      size={ROW_CARD_SIZE}
      title={title}
      meta={detail}
      media={media}
      renderLink={props => <Link {...props} to="/sharing/links" search={{ tab: "photos" }} />}
    />
  );
}

type AlbumCardProps = Readonly<{
  album: Pick<UserAlbumInfo, "id" | "title" | "photo_count" | "cover_photo">;
  /** Its ⋮ menu's items, if it has one. */
  menuItems?: ReactNode;
}>;

/** An album's card: its cover, title and photo count, linking to the album. */
export function AlbumPreviewCard({ album, menuItems }: AlbumCardProps) {
  const { t } = useTranslation();
  return (
    <CollectionCard
      menuItems={menuItems}
      menuLabel={`${t("useralbum.albumActions")}: ${album.title}`}
      className={classes.rowCard}
      size={ROW_CARD_SIZE}
      title={album.title}
      meta={t("numberofphotos", { count: album.photo_count, number: album.photo_count })}
      covers={album.cover_photo ? [album.cover_photo] : []}
      placeholder={<IconPhoto />}
      renderLink={props => <Link {...props} to="/album/user/$id" params={{ id: album.id.toString() }} />}
    />
  );
}
