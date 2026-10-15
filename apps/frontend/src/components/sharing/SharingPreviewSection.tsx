import { Text } from "@mantine/core";
import type { TFunction } from "i18next";
import React from "react";
import type { ReactNode } from "react";
import classes from "../album/AlbumSection.module.css";
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

/** One section of the Sharing overview: its heading, then a placeholder, an empty note or the preview. */
export function SharingPreviewSection({ heading, loading, emptyText, skeleton, children }: Props) {
  return (
    <div className={classes.section}>
      <div className={classes.header}>{heading}</div>
      {loading ? (
        (skeleton ?? <SharePreviewSkeleton />)
      ) : emptyText !== null ? (
        <div className={classes.emptyState}>
          <Text c="dimmed">{emptyText}</Text>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/** "1 photo, 2 albums": each count is pluralised on its own. */
export function itemSummary(t: TFunction, photos: number, albums: number): string {
  return t("sharing.itemSummary", {
    photos: t("sharing.photoCount", { count: photos }),
    albums: t("explore.albumCount", { count: albums }),
  });
}
