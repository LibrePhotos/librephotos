import { Group, Loader, Text } from "@mantine/core";
import type { TablerIcon } from "@tabler/icons-react";
import { useRouter } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth/hooks";
import { useFetchUserListQuery, useFetchUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { parseInstant } from "../../util/dateUtils";
import { formatUnitList } from "../../util/formatCount";
import { PageHeader } from "../PageHeader";
import { isPhotosView, PhotosViewSwitcher } from "./PhotosViewSwitcher";
import { ScanDirectoryWelcome } from "./ScanDirectoryWelcome";

type Props = Readonly<{
  loading: boolean;
  numPhotosetItems: number;
  numPhotos: number;
  icon: TablerIcon;
  title: string;
  // See PhotoListView's `titleBadge`.
  titleBadge?: React.ReactNode;
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
}>;

type PhotoCounterProps = Readonly<
  Pick<
    Props,
    | "loading"
    | "numPhotosetItems"
    | "numPhotos"
    | "hasEmptyState"
    | "countsVideos"
    | "filterHint"
    | "additionalSubHeader"
  >
>;

// "12 days, 340 photos", or only "340 photos" when every item is its own group.
function photoCountLine(
  t: TFunction,
  locale: string,
  {
    numPhotosetItems,
    numPhotos,
    countsVideos,
  }: Pick<PhotoCounterProps, "numPhotosetItems" | "numPhotos" | "countsVideos">
): string {
  const items = t(countsVideos ? "defaultheader.videoscount" : "defaultheader.photoscount", { count: numPhotos });
  if (numPhotosetItems === numPhotos) return items;
  return formatUnitList([t("defaultheader.dayscount", { count: numPhotosetItems }), items], locale);
}

// The subtitle: loading, "No images found", or the day and photo counts, with
// the media filter's hint and the page's own sub-header.
function PhotoCounter({
  loading,
  numPhotosetItems,
  numPhotos,
  hasEmptyState,
  countsVideos,
  filterHint,
  additionalSubHeader,
}: PhotoCounterProps) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  if (loading) {
    return (
      <Group gap={6} wrap="nowrap">
        <Text ta="left" c="dimmed">
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
      <div>
        <Text ta="left" c="dimmed">
          {t("defaultheader.noimages")}
        </Text>
        {filterHint}
      </div>
    );
  }

  return (
    <div>
      <Text ta="left" c="dimmed">
        {photoCountLine(t, locale, { numPhotosetItems, numPhotos, countsVideos })}
      </Text>
      {filterHint}
      {additionalSubHeader}
    </div>
  );
}

// The date beside the title of a one-day list (Recently added).
function DayDate({ date, prefix }: Readonly<{ date: string; prefix?: string }>) {
  const instant = parseInstant(date);
  return (
    <Text style={{ whiteSpace: "nowrap" }}>
      <b>
        {prefix}
        {instant.isValid ? instant.toLocaleString(DateTime.DATE_HUGE) : date}
      </b>
    </Text>
  );
}

export function DefaultHeader(props: Props) {
  const router = useRouter();
  const { data: auth } = useAccessToken();

  const {
    loading,
    numPhotosetItems,
    icon,
    numPhotos,
    title,
    titleBadge,
    additionalSubHeader,
    date,
    dayHeaderPrefix,
    hasEmptyState,
    isPublic,
    countsVideos,
    titleOrder,
    filterHint,
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
      icon={icon}
      title={
        <>
          {titleNode}
          {titleBadge}
        </>
      }
      titleOrder={titleOrder}
      subtitle={
        <PhotoCounter
          loading={loading}
          numPhotosetItems={numPhotosetItems}
          numPhotos={numPhotos}
          hasEmptyState={hasEmptyState}
          countsVideos={countsVideos}
          filterHint={filterHint}
          additionalSubHeader={additionalSubHeader}
        />
      }
      actions={
        (!hasEmptyState || numPhotosetItems > 0) && date ? <DayDate date={date} prefix={dayHeaderPrefix} /> : undefined
      }
    />
  );
}
