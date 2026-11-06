import { Group, Loader, Text } from "@mantine/core";
import { useRouter } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth/hooks";
import { useFetchUserListQuery, useFetchUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { parseInstant } from "../../util/dateUtils";
import { PageHeader } from "../PageHeader";
import { isPhotosView, PhotosViewSwitcher } from "./PhotosViewSwitcher";
import { ScanDirectoryWelcome } from "./ScanDirectoryWelcome";

type Props = Readonly<{
  loading: boolean;
  numPhotosetItems: number;
  numPhotos: number;
  title: string;
  // See PhotoListView's `titleBadge`.
  titleBadge?: React.ReactNode;
  // See PhotoListView's `titleLeading`.
  titleLeading?: React.ReactNode;
  additionalSubHeader: React.ReactNode;
  dayHeaderPrefix?: string;
  date?: string;
  hasEmptyState?: boolean;
  isPublic?: boolean;
  // Count the items as videos rather than photos (the Videos view and the
  // videos-only media filter).
  countsVideos?: boolean;
  // See PhotoListView's `titleOrder`.
  titleOrder?: 1 | 2;
  // A line under the count saying what the page's media filter shows; also
  // shown when the filter matches nothing.
  filterHint?: React.ReactNode;
  // The days are oldest first (#2712): the count line says so, as it is not the usual order.
  oldestFirst?: boolean;
  // The header's right side: the photo list's toolbar.
  actions?: React.ReactNode;
}>;

type PhotoCounterProps = Readonly<
  Pick<
    Props,
    | "loading"
    | "numPhotosetItems"
    | "numPhotos"
    | "hasEmptyState"
    | "countsVideos"
    | "oldestFirst"
    | "date"
    | "dayHeaderPrefix"
  >
>;

// "340 photos · 12 days", or only "340 photos" when every item is its own group.
function photoCountLine(
  t: TFunction,
  {
    numPhotosetItems,
    numPhotos,
    countsVideos,
  }: Pick<PhotoCounterProps, "numPhotosetItems" | "numPhotos" | "countsVideos">
): string {
  const items = t(countsVideos ? "defaultheader.videoscount" : "defaultheader.photoscount", { count: numPhotos });
  if (numPhotosetItems === numPhotos) return items;
  // Photos first, as the count people look for: "3 photos · 1 day"
  return `${items} · ${t("defaultheader.dayscount", { count: numPhotosetItems })}`;
}

// The count line, with "· Oldest first" when the days are in that order.
function countLineWithOrder(
  t: TFunction,
  props: Pick<PhotoCounterProps, "numPhotosetItems" | "numPhotos" | "countsVideos" | "oldestFirst">
): string {
  const line = photoCountLine(t, props);
  return props.oldestFirst ? t("defaultheader.oldestfirst", { counts: line }) : line;
}

// The day of a one-day list (Recently added), after its count: "· Added on Friday, …".
function dayDate(date: string | undefined, prefix: string | undefined): string {
  if (!date) return "";
  const instant = parseInstant(date);
  return ` · ${prefix ?? ""}${instant.isValid ? instant.toLocaleString(DateTime.DATE_HUGE) : date}`;
}

// The subtitle, one dimmed line: loading, "No images found", or the day and photo counts.
function PhotoCounter({
  loading,
  numPhotosetItems,
  numPhotos,
  hasEmptyState,
  countsVideos,
  oldestFirst,
  date,
  dayHeaderPrefix,
}: PhotoCounterProps) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Group gap={6} wrap="nowrap">
        <Text ta="left" c="dimmed" size="sm">
          {t("defaultheader.loading")}
        </Text>
        <Loader size="xs" />
      </Group>
    );
  }

  if (numPhotosetItems < 1) {
    // Don't show "No images found" if an EmptyState will be displayed below
    if (hasEmptyState) {
      return null;
    }
    return (
      <Text ta="left" c="dimmed" size="sm">
        {t("defaultheader.noimages")}
      </Text>
    );
  }

  return (
    <Text ta="left" c="dimmed" size="sm">
      {countLineWithOrder(t, { numPhotosetItems, numPhotos, countsVideos, oldestFirst })}
      {dayDate(date, dayHeaderPrefix)}
    </Text>
  );
}

// Under the title row: the media filter's hint, and once there are photos the page's own lines.
function belowHeader({
  loading,
  numPhotosetItems,
  filterHint,
  additionalSubHeader,
}: Pick<Props, "loading" | "numPhotosetItems" | "filterHint" | "additionalSubHeader">): React.ReactNode {
  if (loading) return null;
  const extra = numPhotosetItems > 0 ? additionalSubHeader : null;
  if (!filterHint && !extra) return null;
  return (
    <>
      {filterHint}
      {extra}
    </>
  );
}

export function DefaultHeader(props: Props) {
  const router = useRouter();
  const { data: auth } = useAccessToken();

  const {
    loading,
    numPhotosetItems,
    numPhotos,
    title,
    titleBadge,
    titleLeading,
    additionalSubHeader,
    date,
    dayHeaderPrefix,
    hasEmptyState,
    isPublic,
    countsVideos,
    titleOrder,
    filterHint,
    oldestFirst,
    actions,
  } = props;

  // Don't fetch user data on public pages
  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(isPublic ? "" : (auth?.access?.user_id ?? ""));
  const { data: userList } = useFetchUserListQuery(isPublic);
  const { location } = router.state;

  // An admin's empty timeline before a scan directory is set: the welcome instead of a header.
  const unconfigured = auth?.access?.is_admin === true && !userSelfDetails?.scan_directory;
  if (unconfigured && !loading && location.pathname === "/" && numPhotosetItems < 1) {
    return <ScanDirectoryWelcome userSelfDetails={userSelfDetails} userList={userList} />;
  }

  // The view switcher on the views that have one; otherwise the plain title
  const titleNode =
    auth?.access && isPhotosView(location.pathname) ? (
      <PhotosViewSwitcher title={title} publicName={auth.access.name} />
    ) : (
      title
    );

  return (
    <PageHeader
      title={
        <>
          {titleNode}
          {titleBadge}
        </>
      }
      titleOrder={titleOrder}
      leading={titleLeading}
      subtitle={
        <PhotoCounter
          loading={loading}
          numPhotosetItems={numPhotosetItems}
          numPhotos={numPhotos}
          hasEmptyState={hasEmptyState}
          countsVideos={countsVideos}
          oldestFirst={oldestFirst}
          date={(!hasEmptyState || numPhotosetItems > 0) && date ? date : undefined}
          dayHeaderPrefix={dayHeaderPrefix}
        />
      }
      below={belowHeader({ loading, numPhotosetItems, filterHint, additionalSubHeader })}
      actions={actions}
    />
  );
}
