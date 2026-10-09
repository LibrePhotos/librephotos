import { Text } from "@mantine/core";
import { IconFilterOff as FilterOff, IconPhoto as Photo } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { Photoset, PigPhoto } from "../../api_client/photos/types";
import { EmptyStateConfig, PhotoGroup, PhotoListView } from "../../components/photolist/PhotoListView";
import {
  countActiveFilters,
  describeTimelineFilter,
  SHOW_EVERYTHING,
  timelineFilterKey,
  timelineFilterToBulkQuery,
  validateTimelineSearch,
} from "../../components/photolist/timelineFilter";
import { TimelineFilterPopover } from "../../components/photolist/TimelineFilterPopover";
import { useHasNoScanDirectory } from "../../components/photolist/useScanEmptyStateAction";
import { useTimelineFilter } from "../../components/photolist/useTimelineFilter";
import type { PigVisibleGroup } from "../../components/react-pig";
import { useWorkerStatus } from "../../hooks/useWorkerStatus";
import { i18nResolvedLanguage } from "../../i18n";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

export const Route = createFileRoute("/_protected/")({
  component: TimestampPhotos,
  // ?media=, ?hide_screenshots=, ?hide_documents=, ?favorites= override the
  // user's saved default timeline filter key by key; none of them is the
  // default.
  validateSearch: validateTimelineSearch,
});

function TimestampPhotos() {
  const { t } = useTranslation();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);
  const { workerRunningJob } = useWorkerStatus();
  // Only an admin can set a user's scan folder, so "Go to Library" would be a
  // dead end; point at what others shared instead.
  const hasNoScanDirectory = useHasNoScanDirectory();
  const {
    current: filter,
    saved: savedFilter,
    ready: filterReady,
    setFilter,
    reset: resetFilter,
    saveAsDefault,
    saving: savingDefault,
    libraryEmpty,
  } = useTimelineFilter();
  const filterActive = countActiveFilters(filter) > 0;
  const filterKey = timelineFilterKey(filter);

  // Waits for the saved default: fetching before it loaded would show (and
  // cache) the unfiltered library for a moment.
  const {
    data: photosGroupedByDate,
    isLoading,
    refetch,
  } = useFetchDateAlbumsQuery({ photosetType: Photoset.NONE, timelineFilter: filter }, { skip: !filterReady });

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  // The day page to load, with the filter it was asked under: after the
  // filter changes, a day of the old list is not requested again under the
  // new filter (it may not even be in the new list).
  const [group, setGroup] = useState({} as PhotoGroup & { filterKey?: string });
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.NONE, timelineFilter: filter },
    { skip: !group.id || !filterReady || group.filterKey !== filterKey }
  );

  // Pig reports the date groups on screen; a group's first placeholder tile
  // names the page of that day still to load.
  const getAlbums = (visibleGroups: PigVisibleGroup<PigPhoto>[]) => {
    visibleGroups.reverse().forEach(photoGroup => {
      const firstTempObject = photoGroup.items.find(i => i.isTemp);
      if (firstTempObject) {
        const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);

        setGroup({ id: photoGroup.id, page, filterKey });
      }
    });
  };

  // Check if a scan-related job is running
  const isScanRunning =
    workerRunningJob &&
    (workerRunningJob.job_type_str?.toLowerCase().includes("scan") ||
      workerRunningJob.job_type_str?.toLowerCase().includes("photo"));

  const emptyStateConfig: EmptyStateConfig = useMemo(() => {
    if (isScanRunning && workerRunningJob) {
      return {
        icon: <Photo size={40} />,
        // The English job name is also the translation key, as in the job list.
        title: `${t("emptystate.scanning.title")} — ${t(workerRunningJob.job_type_str)}`,
        description: t("emptystate.scanning.refresh"),
        actionLabel: t("emptystate.scanning.refreshButton"),
        onAction: () => refetch(),
        progress: {
          current: workerRunningJob.progress_current ?? 0,
          target: workerRunningJob.progress_target ?? 0,
        },
      };
    }

    // An empty library says so even with a saved default; only a filter that
    // hides photos the library does have gets the "nothing matches" state.
    if (filterActive && !libraryEmpty) {
      return {
        icon: <FilterOff size={40} />,
        title: t("timelinefilter.empty.title"),
        description: t("timelinefilter.empty.description"),
        actionLabel: t("timelinefilter.empty.action"),
        onAction: () => setFilter(SHOW_EVERYTHING),
      };
    }

    if (hasNoScanDirectory) {
      return {
        icon: <Photo size={40} />,
        title: t("emptystate.photos.title"),
        description: t("emptystate.photos.noscandirectory"),
        actionLabel: t("sidemenu.sharedwithyou"),
        actionLink: "/sharing/withme/albums",
      };
    }

    return {
      icon: <Photo size={40} />,
      title: t("emptystate.photos.title"),
      description: t("emptystate.photos.description"),
      actionLabel: t("emptystate.goToLibrary"),
      actionLink: "/library",
    };
  }, [t, isScanRunning, workerRunningJob, refetch, filterActive, libraryEmpty, setFilter, hasNoScanDirectory]);

  // Select-all carries the filter on screen, so "select all, then delete"
  // never reaches the screenshots or documents the timeline hides.
  const photosetQuery = useMemo(() => timelineFilterToBulkQuery(filter), [filter]);

  const filterSummary = useMemo(
    () =>
      filterActive ? (
        <Text ta="left" size="sm" c="blue">
          {t("timelinefilter.filtered", { summary: describeTimelineFilter(filter, t, i18nResolvedLanguage()) })}
        </Text>
      ) : null,
    [filterActive, filter, t]
  );

  const filterButton = useMemo(
    () => (
      <TimelineFilterPopover
        current={filter}
        saved={savedFilter}
        onChange={setFilter}
        onReset={resetFilter}
        onSaveDefault={saveAsDefault}
        saving={savingDefault}
        ready={filterReady}
      />
    ),
    [filter, savedFilter, setFilter, resetFilter, saveAsDefault, savingDefault, filterReady]
  );

  return (
    <PhotoListView
      title={t("photos.photos")}
      loading={isLoading || !filterReady}
      icon={<Photo size={50} />}
      photoset={photosGroupedByDate ?? []}
      idx2hash={photosFlat}
      updateGroups={getAlbums}
      selectable
      emptyStateConfig={emptyStateConfig}
      photosetQuery={photosetQuery}
      additionalSubHeader={filterSummary}
      headerActions={filterButton}
    />
  );
}
