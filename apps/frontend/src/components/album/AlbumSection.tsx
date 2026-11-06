import { Group, Skeleton, Text, Title } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";
import React from "react";
import { useTranslation } from "react-i18next";
import { CollectionCard } from "../common/CollectionCard";
import { ErrorState } from "../common/ErrorState";
import type { ListFailure } from "../common/useListFailure";
import classes from "./AlbumSection.module.css";

type AlbumPreview = {
  id: string | number;
  title: string;
  photoCount: number;
  coverUrl?: string;
  isVideo?: boolean;
  linkTo: string;
  icon?: React.ReactNode;
};

type AlbumSectionVariant = "scroll" | "card";

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
};

function getDetfaultMaxItems(variant: AlbumSectionVariant): number {
  switch (variant) {
    case "card":
      return 6;
    case "scroll":
      return 20;
  }
}

function LoadingCard() {
  return <Skeleton className={classes.cardLoading} radius={12} />;
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

function LoadingComponent({ variant, title }: { variant: AlbumSectionVariant; title: string }) {
  switch (variant) {
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
}: AlbumSectionProps) {
  const { t } = useTranslation();
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
