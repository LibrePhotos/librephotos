import type { UserAlbumInfo } from "@librephotos/api-client";
import { Group, Skeleton, Text, Title } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import classes from "../album/AlbumSection.module.css";
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
        <div key={i} className={classes.skeleton}>
          <Skeleton height={140} radius="md" />
          <Skeleton height={16} mt={8} width="80%" />
          <Skeleton height={12} mt={4} width="50%" />
        </div>
      ))}
    </div>
  );
}

type PhotoCoverProps = Readonly<{ imageHash: string; video: boolean }>;

/** A photo's square cover on a preview card. */
export function PhotoPreviewCover({ imageHash, video }: PhotoCoverProps) {
  return (
    <div className={classes.albumCover}>
      <Tile video={video} width={140} height={140} image_hash={imageHash} className={classes.albumCoverImage} />
    </div>
  );
}

type InfoProps = Readonly<{ title: string; detail: string }>;

const NO_BREAK_SPACE = "\u00a0";

/** The caption under a card's cover: what it is, then a dimmed detail line. */
export function SharePreviewInfo({ title, detail }: InfoProps) {
  return (
    <div className={classes.albumInfo}>
      <Text size="sm" fw={500} lineClamp={1} title={title}>
        {title}
      </Text>
      {/* A blank line when there is no detail, so every card in a row has one height */}
      <Text size="xs" c="dimmed" lineClamp={1}>
        {detail || NO_BREAK_SPACE}
      </Text>
    </div>
  );
}

type AlbumCardProps = Readonly<{
  album: Pick<UserAlbumInfo, "id" | "title" | "photo_count" | "cover_photo">;
}>;

/** An album's card: its cover (or "No cover"), title and photo count, linking to the album. */
export function AlbumPreviewCard({ album }: AlbumCardProps) {
  const { t } = useTranslation();
  return (
    <Link to="/album/user/$id" params={{ id: album.id.toString() }} className={classes.albumCard}>
      {album.cover_photo ? (
        <PhotoPreviewCover imageHash={album.cover_photo.image_hash} video={album.cover_photo.video ?? false} />
      ) : (
        <div className={classes.albumCover}>
          <Text c="dimmed" size="xs">
            {t("explore.noCover")}
          </Text>
        </div>
      )}
      <SharePreviewInfo
        title={album.title}
        detail={t("numberofphotos", { count: album.photo_count, number: album.photo_count })}
      />
    </Link>
  );
}
