import { Paper, Text } from "@mantine/core";
import type { TFunction } from "i18next";
import React from "react";
import type { ReactNode } from "react";
import classes from "../album/AlbumSection.module.css";
import overviewClasses from "./SharingOverview.module.css";
import { SharePreviewSkeleton } from "./SharingPreviewCards";

type Props = Readonly<{
  /** The link to the section's page, holding its SharingSectionHeading. */
  heading: ReactNode;
  loading: boolean;
  /** Shown instead of the preview when there is nothing in it. */
  emptyText: string | null;
  /** The placeholder while loading; a row of cards by default. */
  skeleton?: ReactNode;
  children: ReactNode;
}>;

/**
 * One section of the Sharing overview, in the same bordered card as "Your library" above it: its
 * heading, then a placeholder, the preview, or with nothing in it one dimmed line under the heading
 * instead of a reserved empty box.
 */
export function SharingPreviewSection({ heading, loading, emptyText, skeleton, children }: Props) {
  return (
    <Paper withBorder radius="md" p="md">
      <div className={classes.header}>{heading}</div>
      {loading ? (
        (skeleton ?? <SharePreviewSkeleton />)
      ) : emptyText !== null ? (
        <Text fz={13} c="dimmed" className={overviewClasses.emptyLine}>
          {emptyText}
        </Text>
      ) : (
        children
      )}
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
