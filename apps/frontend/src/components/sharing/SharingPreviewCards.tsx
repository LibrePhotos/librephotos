import type { PigPhoto, UserAlbumInfo } from "@librephotos/api-client";
import { Group, Skeleton, Text, Title } from "@mantine/core";
import { IconChevronRight, IconPhoto } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { DateTime } from "luxon";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { parsePhotoTimestamp } from "../../util/dateUtils";
import { ROW_CARD_SIZE } from "../album/AlbumSection";
import classes from "../album/AlbumSection.module.css";
import { CollectionCard, collectionCardImageClass } from "../common/CollectionCard";
import { Tile } from "../Tile";
import overviewClasses from "./SharingOverview.module.css";

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
          <Text size="sm" className={overviewClasses.viewAll}>
            {t("explore.viewAll")}
          </Text>
          <IconChevronRight size={14} className={overviewClasses.viewAll} />
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

/**
 * When a photo was taken, as a date in the UI language. A photo is shared or made public without a
 * timestamp of its own, so its own date is what tells two of them apart.
 */
export function photoTakenDate(photo: Pick<PigPhoto, "date">): string {
  if (!photo.date) return "";
  const taken = parsePhotoTimestamp(photo.date);
  return taken.isValid ? taken.toLocaleString(DateTime.DATE_MED) : "";
}

/** What a shared photo's link wraps: spread on a router Link to the section's photo tab. */
type SharedPhotoLinkProps = Readonly<{ className: string | undefined; "aria-label": string; children: ReactNode }>;

type SharedPhotoCardProps = Readonly<{
  photo: Pick<PigPhoto, "id" | "type" | "date">;
  renderLink: (props: SharedPhotoLinkProps) => ReactNode;
}>;

/**
 * A shared photo in a "shared with you" or "you shared" row: the album cards' look, titled by the
 * day it was taken (what tells two photos apart) with "Photo" or "Video" as its dimmed line, so a
 * row of photos and albums is one kind of card. Undated, the kind is the title.
 */
export function SharedPhotoCard({ photo, renderLink }: SharedPhotoCardProps) {
  const { t } = useTranslation();
  const video = photo.type === "video";
  const kind = video ? t("phototile.video") : t("phototile.photo");
  const taken = photoTakenDate(photo);
  return (
    <CollectionCard
      className={classes.rowCard}
      size={ROW_CARD_SIZE}
      title={taken || kind}
      meta={taken ? kind : undefined}
      linkLabel={taken ? `${kind}, ${taken}` : kind}
      media={
        <Tile
          video={video}
          width={ROW_CARD_SIZE}
          height={ROW_CARD_SIZE}
          image_hash={photo.id}
          className={collectionCardImageClass}
        />
      }
      renderLink={renderLink}
    />
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
