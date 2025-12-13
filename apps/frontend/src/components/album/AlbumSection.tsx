import { Avatar, Button, Group, Image, Skeleton, Stack, Text, Title } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import React from "react";
import { useTranslation } from "react-i18next";
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

type AlbumSectionProps = {
  title: string;
  icon: React.ReactNode;
  albums: AlbumPreview[];
  viewAllLink: string;
  isLoading?: boolean;
  emptyMessage?: string;
  count?: number;
  variant?: AlbumSectionVariant;
  maxItems?: number;
  actionLink?: string;
  actionLabel?: string;
  actionIcon?: React.ReactNode;
  actionColor?: string;
};

function getDetfaultMaxItems(variant: AlbumSectionVariant): number {
  switch (variant) {
    case "avatarGrid":
      return 14;
    case "card":
      return 6;
    default:
      return 20;
  }
}

function LoadingCard() {
  return (
    <div className={classes.sectionCompact}>
      <div className={classes.cardLoading}>
        <Skeleton height={120} />
        <Stack p="xs" gap="xs">
          <Skeleton height={20} width="60%" />
          <Skeleton height={14} width="40%" />
        </Stack>
      </div>
    </div>
  );
}

function LoadingAvararGrid({ icon, title }: { icon: React.FC; title: string }): React.FC {
  return (
    <div className={classes.section}>
      <div className={classes.header}>
        <div className={classes.headerLeft}>
          {icon}
          <div>
            <Title order={4}>{title}</Title>
            <Skeleton height={14} width={80} mt={4} />
          </div>
        </div>
      </div>
      <div className={classes.avatarGridLoading}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <div key={i} className={classes.avatarSkeleton}>
            <Skeleton height={56} width={56} circle />
            <Skeleton height={10} width={50} mt={4} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingOther({ icon, title }: { icon: React.FC; title: string }): React.FC {
  return (
    <div className={classes.section}>
      <div className={classes.header}>
        <div className={classes.headerLeft}>
          {icon}
          <div>
            <Title order={4}>{title}</Title>
            <Skeleton height={14} width={80} mt={4} />
          </div>
        </div>
      </div>
      <div className={classes.loadingContainer}>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className={classes.skeleton}>
            <Skeleton height={140} radius="md" />
            <Skeleton height={16} mt={8} width="80%" />
            <Skeleton height={12} mt={4} width="50%" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AvatarPreview({ album }: { album: AlbumPreview }): React.FC {
  if (album.faceUrl) {
    return <Image src={album.faceUrl} w={56} h={56} className={classes.avatarImage} fallbackSrc="/unknown_user.jpg" />;
  }

  if (album.coverUrl) {
    return (
      <Tile
        video={album.isVideo ?? false}
        width={56}
        height={56}
        image_hash={album.coverUrl}
        className={classes.avatarImage}
      />
    );
  }

  return (
    <Avatar size={52} radius="xl" color="gray">
      {album.title.charAt(0).toUpperCase()}
    </Avatar>
  );
}

function ScrollPreview({ album }: { album: AlbumPreview }): React.FC {
  if (album.coverUrl) {
    return (
      <Tile
        video={album.isVideo ?? false}
        width={140}
        height={140}
        image_hash={album.coverUrl}
        className={classes.albumCoverImage}
      />
    );
  }
  if (album.icon) {
    return album.icon;
  }

  return (
    <Text c="dimmed" size="xs">
      {t("explore.noCover")}
    </Text>
  );
}

function LoadingComponent({
  variant,
  icon,
  title,
}: {
  variant: AlbumSectionVariant;
  icon: React.FC;
  title: string;
}): React.FC {
  switch (variant) {
    case "avatarGrid":
      return <LoadingAvararGrid icon={icon} title={title} />;
    case "card":
      return <LoadingCard />;
    default:
      return <LoadingOther icon={icon} title={title} />;
  }
}

export function AlbumSection({
  title,
  icon,
  albums,
  viewAllLink,
  isLoading = false,
  emptyMessage,
  count,
  variant = "scroll",
  maxItems,
  actionLink,
  actionLabel,
  actionIcon,
  actionColor = "blue",
}: AlbumSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const displayCount = count ?? albums.length;

  // Determine max items based on variant
  const defaultMaxItems = getDetfaultMaxItems(variant);
  const itemLimit = maxItems ?? defaultMaxItems;

  if (isLoading) {
    return <LoadingComponent variant={variant} icon={icon} title={title} />;
  }

  // Card variant - compact dashboard tile with multiple thumbnails
  if (variant === "card") {
    const previewAlbums = albums.slice(0, 6).filter(a => a.coverUrl || a.icon);
    const hasCovers = previewAlbums.some(a => a.coverUrl);

    return (
      <Link to={viewAllLink} className={classes.cardContainer}>
        <div className={classes.cardCover}>
          {hasCovers ? (
            // Show up to 3 thumbnails in a row
            previewAlbums.slice(0, 3).map(album =>
              album.coverUrl ? (
                <Tile
                  key={album.id}
                  video={album.isVideo ?? false}
                  width={200}
                  height={120}
                  image_hash={album.coverUrl}
                  className={classes.cardCoverThumbnail}
                />
              ) : (
                <div key={album.id} className={classes.cardCoverSingle}>
                  {album.icon || icon}
                </div>
              )
            )
          ) : (
            <div className={classes.cardCoverSingle}>{icon}</div>
          )}
        </div>
        <div className={classes.cardBody}>
          <div className={classes.cardTitle}>
            {icon}
            <Text fw={600} size="sm">
              {title}
            </Text>
          </div>
          <Text size="xs" c="dimmed" mt={4}>
            {t("explore.albumCount", { count: displayCount })}
          </Text>
        </div>
      </Link>
    );
  }

  // Avatar Grid variant - for People
  if (variant === "avatarGrid") {
    return (
      <div className={classes.section}>
        <Group justify="space-between" align="flex-start" pr="md" className={classes.header}>
          <Link to={viewAllLink} className={clsx(classes.headerLeft, classes.headerReset)}>
            {icon}
            <div>
              <Title order={4}>{title}</Title>
              <Group gap={6}>
                <Text size="sm" c="dimmed">
                  {t("explore.albumCount", { count: displayCount })}
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
          </Link>
          {actionLink && actionLabel && (
            <Button
              leftSection={actionIcon}
              variant="light"
              color={actionColor}
              size="xs"
              onClick={() => navigate({ to: actionLink })}
            >
              {actionLabel}
            </Button>
          )}
        </Group>

        {albums.length === 0 ? (
          <div className={classes.emptyState}>
            <Text c="dimmed">{emptyMessage ?? t("explore.noAlbums")}</Text>
          </div>
        ) : (
          <div className={classes.avatarGrid}>
            {albums.slice(0, itemLimit).map(album => (
              <Link key={album.id} to={album.linkTo} className={classes.avatarItem}>
                <div className={classes.avatar}>
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
      <div className={classes.header}>
        <Link to={viewAllLink} className={clsx(classes.headerLeft, classes.headerReset)}>
          {icon}
          <div>
            <Title order={4}>{title}</Title>
            <Group gap={6}>
              <Text size="sm" c="dimmed">
                {t("explore.albumCount", { count: displayCount })}
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
        </Link>
      </div>

      {albums.length === 0 ? (
        <div className={classes.emptyState}>
          <Text c="dimmed">{emptyMessage ?? t("explore.noAlbums")}</Text>
        </div>
      ) : (
        <div className={classes.scrollContainer}>
          {albums.slice(0, itemLimit).map(album => (
            <Link key={album.id} to={album.linkTo} className={classes.albumCard}>
              <div className={classes.albumCover}>
                <ScrollPreview album={album} />
              </div>
              <div className={classes.albumInfo}>
                <Text size="sm" fw={500} lineClamp={1} title={album.title}>
                  {album.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {t("numberofphotos", { number: album.photoCount })}
                </Text>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export type { AlbumPreview, AlbumSectionProps, AlbumSectionVariant };
