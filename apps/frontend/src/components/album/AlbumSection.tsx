import { Avatar, Button, Group, Image, Skeleton, Text, Title } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import React from "react";
import { useTranslation } from "react-i18next";
import { CollectionCard } from "../common/CollectionCard";
import { ErrorState } from "../common/ErrorState";
import type { ListFailure } from "../common/useListFailure";
import { Tile } from "../Tile";
import classes from "./AlbumSection.module.css";

type AlbumPreview = {
  id: string | number;
  title: string;
  photoCount: number;
  coverUrl?: string;
  faceUrl?: string; // Direct URL for face images
  isVideo?: boolean;
  linkTo: string;
  icon?: React.ReactNode;
};

type AlbumSectionVariant = "scroll" | "avatarGrid" | "card";

/** The width of a card in a scrolling row, the size of an album cover on the album lists. */
export const ROW_CARD_SIZE = 180;
/** About the width of a card in the hub's grid (My Albums, Collections), for its covers' size attributes. */
export const HUB_CARD_WIDTH = 240;

type AlbumSectionProps = {
  title: string;
  /** The glyph of a category card without covers. */
  icon?: React.ReactNode;
  albums: AlbumPreview[];
  viewAllLink: string;
  isLoading?: boolean;
  /** The list failed to load: Retry instead of the empty message (the card variant only links to the list). */
  error?: ListFailure;
  emptyMessage?: string;
  count?: number;
  /** What the count is shown as; defaults to "N albums", wrong for people, tags or folders. */
  countLabel?: string;
  variant?: AlbumSectionVariant;
  maxItems?: number;
  actionLink?: string;
  actionLabel?: string;
  actionIcon?: React.ReactNode;
};

function getDetfaultMaxItems(variant: AlbumSectionVariant): number {
  switch (variant) {
    case "avatarGrid":
      return 14;
    case "card":
      return 6;
    case "scroll":
      return 20;
  }
}

function LoadingCard() {
  return <Skeleton className={classes.cardLoading} radius={12} />;
}

function LoadingAvararGrid({ title }: { title: string }) {
  return (
    <div className={classes.section}>
      <div className={classes.header}>
        <div className={classes.headerLeft}>
          <div>
            <Title order={4}>{title}</Title>
            <Skeleton height={14} width={80} mt={4} />
          </div>
        </div>
      </div>
      <div className={classes.avatarGridLoading}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <div key={i} className={classes.avatarSkeleton}>
            <Skeleton height={64} width={64} circle />
            <Skeleton height={10} width={50} mt={4} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingOther({ title }: { title: string }) {
  return (
    <div className={classes.section}>
      <div className={classes.header}>
        <div className={classes.headerLeft}>
          <div>
            <Title order={4}>{title}</Title>
            <Skeleton height={14} width={80} mt={4} />
          </div>
        </div>
      </div>
      <div className={classes.loadingContainer}>
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} className={classes.skeleton} radius={12} />
        ))}
      </div>
    </div>
  );
}

function AvatarPreview({ album }: { album: AlbumPreview }) {
  if (album.faceUrl) {
    return (
      <Image
        src={album.faceUrl}
        w="100%"
        h="100%"
        className={classes.avatarImage}
        fallbackSrc="/unknown_user.jpg"
        alt=""
      />
    );
  }

  if (album.coverUrl) {
    return (
      <Tile
        video={album.isVideo ?? false}
        width={64}
        height={64}
        image_hash={album.coverUrl}
        className={classes.avatarImage}
      />
    );
  }

  return (
    <Avatar size="100%" radius="xl" color="gray">
      {album.title.charAt(0).toUpperCase()}
    </Avatar>
  );
}

function LoadingComponent({ variant, title }: { variant: AlbumSectionVariant; title: string }) {
  switch (variant) {
    case "avatarGrid":
      return <LoadingAvararGrid title={title} />;
    case "card":
      return <LoadingCard />;
    case "scroll":
      return <LoadingOther title={title} />;
  }
}

type HeadingProps = Readonly<{
  title: string;
  /** "6 albums": with `viewAllLink`, followed by "· View all ›". */
  summary?: string;
  /** The heading links here. */
  viewAllLink?: string;
  /** On the right, level with the title: a quiet button. */
  action?: React.ReactNode;
}>;

/**
 * A section heading of the album hub and its rows: the title with its count and "View all" under
 * it, on the page's left edge like every row under it, and an optional action on the right.
 */
export function AlbumSectionHeading({ title, summary, viewAllLink, action }: HeadingProps) {
  const { t } = useTranslation();
  const heading = (
    <div>
      <Title order={4}>{title}</Title>
      {summary !== undefined && (
        <Group gap={6}>
          <Text size="sm" c="dimmed">
            {summary}
          </Text>
          {viewAllLink && (
            <>
              <Text size="sm" c="dimmed">
                ·
              </Text>
              <Text size="sm" c="blue">
                {t("explore.viewAll")}
              </Text>
              <IconChevronRight size={14} color="var(--mantine-color-blue-6)" />
            </>
          )}
        </Group>
      )}
    </div>
  );
  return (
    <div className={classes.header}>
      {viewAllLink ? (
        <Link to={viewAllLink} className={clsx(classes.headerLeft, classes.headerReset)}>
          {heading}
        </Link>
      ) : (
        <div className={classes.headerLeft}>{heading}</div>
      )}
      {action}
    </div>
  );
}

export function AlbumSection({
  title,
  icon,
  albums,
  viewAllLink,
  isLoading = false,
  error,
  emptyMessage,
  count,
  countLabel,
  variant = "scroll",
  maxItems,
  actionLink,
  actionLabel,
  actionIcon,
}: AlbumSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const displayCount = count ?? albums.length;
  const countText = countLabel ?? t("explore.albumCount", { count: displayCount });

  // Determine max items based on variant
  const defaultMaxItems = getDetfaultMaxItems(variant);
  const itemLimit = maxItems ?? defaultMaxItems;

  if (isLoading) {
    return <LoadingComponent variant={variant} title={title} />;
  }

  // Card variant: a category on the hub, up to three of its covers side by side
  if (variant === "card") {
    const covers = albums.flatMap(album =>
      album.coverUrl ? [{ image_hash: album.coverUrl, video: album.isVideo }] : []
    );
    return (
      <CollectionCard
        shape="wide"
        size={HUB_CARD_WIDTH}
        title={title}
        meta={countText}
        covers={covers.slice(0, 3)}
        placeholder={icon}
        renderLink={props => <Link {...props} to={viewAllLink} />}
      />
    );
  }

  // Avatar Grid variant - for People
  if (variant === "avatarGrid") {
    return (
      <div className={classes.section}>
        <AlbumSectionHeading
          title={title}
          summary={countText}
          viewAllLink={viewAllLink}
          action={
            actionLink &&
            actionLabel && (
              // A quiet default button: the hub's one accent stays on the links
              <Button leftSection={actionIcon} variant="default" size="xs" onClick={() => navigate({ to: actionLink })}>
                {actionLabel}
              </Button>
            )
          }
        />

        {error ? (
          <ErrorState failure={error} compact />
        ) : albums.length === 0 ? (
          <div className={classes.emptyState}>
            <Text c="dimmed">{emptyMessage ?? t("explore.noAlbums")}</Text>
          </div>
        ) : (
          <div className={classes.avatarGrid}>
            {albums.slice(0, itemLimit).map(album => (
              <Link key={album.id} to={album.linkTo} className={classes.avatarItem}>
                <div className={clsx(classes.avatar, classes.avatarLarge)}>
                  <AvatarPreview album={album} />
                </div>
                <Text className={classes.avatarName} title={album.title}>
                  {album.title}
                </Text>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Default scroll variant
  return (
    <div className={classes.section}>
      <AlbumSectionHeading title={title} summary={countText} viewAllLink={viewAllLink} />

      {error ? (
        <ErrorState failure={error} compact />
      ) : albums.length === 0 ? (
        <div className={classes.emptyState}>
          <Text c="dimmed">{emptyMessage ?? t("explore.noAlbums")}</Text>
        </div>
      ) : (
        <div className={classes.scrollContainer}>
          {albums.slice(0, itemLimit).map(album => (
            <CollectionCard
              key={album.id}
              className={classes.rowCard}
              size={ROW_CARD_SIZE}
              title={album.title}
              meta={t("numberofphotos", { count: album.photoCount, number: album.photoCount })}
              covers={album.coverUrl ? [{ image_hash: album.coverUrl, video: album.isVideo }] : []}
              placeholder={album.icon}
              renderLink={props => <Link {...props} to={album.linkTo} />}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export type { AlbumSectionProps };
