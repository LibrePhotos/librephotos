import { Paper, Text, Title } from "@mantine/core";
import type { TFunction } from "i18next";
import React from "react";
import type { ReactNode } from "react";
import classes from "../album/AlbumSection.module.css";
import overviewClasses from "./SharingOverview.module.css";
import { SharePreviewSkeleton, SharingSectionHeading } from "./SharingPreviewCards";

/** What the heading's link wraps: spread on a router Link to the section's page. */
type HeadingLinkProps = Readonly<{ className: string; children: ReactNode }>;

type Props = Readonly<{
  /** The section's 24px icon. */
  icon: ReactNode;
  title: string;
  /** "N photos, M albums", before the heading's "View all". */
  summary: string;
  /** The link to the section's page around its heading. */
  renderLink: (props: HeadingLinkProps) => ReactNode;
  loading: boolean;
  /** Says there is nothing in the section; null when there is. */
  emptyText: string | null;
  /** The placeholder while loading; a row of cards by default. */
  skeleton?: ReactNode;
  children: ReactNode;
}>;

const HEADING_LINK = `${classes.headerLeft} ${classes.headerReset}`;

/**
 * One section of the Sharing overview, in the same bordered card as "Your library" above it: its
 * heading linking to its page, then a placeholder or the preview. With nothing in it the section is
 * one compact row (icon, title, a dimmed line) without the "View all" into an empty page.
 */
export function SharingPreviewSection({
  icon,
  title,
  summary,
  renderLink,
  loading,
  emptyText,
  skeleton,
  children,
}: Props) {
  if (!loading && emptyText !== null) {
    return (
      <Paper withBorder radius="md" px="md" className={overviewClasses.emptyRow}>
        {icon}
        <Title order={4} className={overviewClasses.emptyTitle}>
          {title}
        </Title>
        <Text size="sm" c="dimmed" truncate>
          {emptyText}
        </Text>
      </Paper>
    );
  }
  return (
    <Paper withBorder radius="md" p="md">
      <div className={classes.header}>
        {renderLink({
          className: HEADING_LINK,
          children: <SharingSectionHeading icon={icon} title={title} summary={summary} />,
        })}
      </div>
      {loading ? (skeleton ?? <SharePreviewSkeleton />) : children}
    </Paper>
  );
}

/** "1 photo, 2 albums": each count is pluralised on its own. */
export function itemSummary(t: TFunction, photos: number, albums: number): string {
  return t("sharing.itemSummary", {
    photos: t("sharing.photoCount", { count: photos }),
    albums: t("explore.albumCount", { count: albums }),
  });
}
