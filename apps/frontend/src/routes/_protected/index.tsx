import { Photoset } from "@librephotos/api-client";
import { Text } from "@mantine/core";
import { IconFilterOff as FilterOff, IconPhoto as Photo } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDateAlbumDayPages, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useListFailure } from "../../components/common/useListFailure";
import { jobTypeLabel } from "../../components/job/jobTypeLabel";
import { TimelineLibrariesNote } from "../../components/libraryShare/TimelineLibrariesNote";
import { MemoriesStrip } from "../../components/memories/MemoriesStrip";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { EmptyStateConfig } from "../../components/photolist/PhotoListView";
import { withPhotoSearch } from "../../components/photolist/photoSearch";
import {
  countActiveFilters,
  describeTimelineFilter,
  SHOW_EVERYTHING,
  timelineFilterToBulkQuery,
  validateTimelineSearch,
} from "../../components/photolist/timelineFilter";
import { TimelineFilterPopover } from "../../components/photolist/TimelineFilterPopover";
import { useGroupedPhotos } from "../../components/photolist/useGroupedPhotos";
import { useHasNoScanDirectory } from "../../components/photolist/useScanEmptyStateAction";
import { useTimelineFilter } from "../../components/photolist/useTimelineFilter";
import { useOptionalUploadProcessing } from "../../components/upload";
import { importCounts } from "../../components/upload/uploadProcessing";
import { useWorkerStatus } from "../../hooks/useWorkerStatus";
import { i18nResolvedLanguage } from "../../i18n";

export const Route = createFileRoute("/_protected/")({
  component: TimestampPhotos,
  // ?media=, ?hide_screenshots=, ?hide_documents=, ?favorites= override the
  // user's saved default timeline filter key by key; none of them is the
  // default. ?photo= is the photo open in the lightbox.
  validateSearch: withPhotoSearch(validateTimelineSearch),
});

function TimestampPhotos() {
  const { t } = useTranslation();
  const { workerRunningJob } = useWorkerStatus();
  // Uploads still being imported (#2739): the photos are on their way, like a running scan's.
  const openImports = useOptionalUploadProcessing()?.openImports;
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
    failure: filterFailure,
  } = useTimelineFilter();
  const filterActive = countActiveFilters(filter) > 0;

  // Waits for the saved default: fetching before it loaded would show (and
  // cache) the unfiltered library for a moment.
  const photosQuery = useFetchDateAlbumsQuery(
    // With the libraries others share with me and I show in my timeline (#2731).
    { photosetType: Photoset.NONE, timelineFilter: filter, withLibraries: true },
    { skip: !filterReady }
  );
  const { data: photosGroupedByDate, isLoading, refetch } = photosQuery;
  const listFailure = useListFailure(photosQuery);

  const { groups, photosFlat } = useGroupedPhotos(photosGroupedByDate);

  // Pig reports the date groups on screen; their placeholder tiles name the
  // pages of those days still to load. Pages are keyed by the filter, so after
  // it changes a day of the old list is not requested again under the new one.
  const getAlbums = useDateAlbumDayPages(
    { photosetType: Photoset.NONE, timelineFilter: filter, withLibraries: true },
    { skip: !filterReady }
  );

  // Check if a scan-related job is running
  const isScanRunning =
    workerRunningJob &&
    (workerRunningJob.job_type_str?.toLowerCase().includes("scan") ||
      workerRunningJob.job_type_str?.toLowerCase().includes("photo"));

  const emptyStateConfig: EmptyStateConfig = useMemo(() => {
    if (isScanRunning && workerRunningJob) {
      return {
        icon: <Photo size={40} />,
        title: t("emptystate.scanning.titlewithjob", { job: jobTypeLabel(workerRunningJob, t) }),
        description: t("emptystate.scanning.refresh"),
        actionLabel: t("emptystate.scanning.refreshButton"),
        onAction: () => refetch(),
        progress: {
          current: workerRunningJob.progress_current ?? 0,
          target: workerRunningJob.progress_target ?? 0,
        },
      };
    }

    if (openImports && openImports.length > 0) {
      const { ready, total } = importCounts(openImports);
      return {
        icon: <Photo size={40} />,
        title: t("emptystate.importing.title"),
        description: t("emptystate.importing.description"),
        actionLabel: t("emptystate.scanning.refreshButton"),
        onAction: () => refetch(),
        progress: { current: ready, target: total },
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
  }, [
    t,
    isScanRunning,
    workerRunningJob,
    openImports,
    refetch,
    filterActive,
    libraryEmpty,
    setFilter,
    hasNoScanDirectory,
  ]);

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
  // Whose libraries the timeline shows besides mine (#2731), beside the title.
  const librariesNote = useMemo(() => <TimelineLibrariesNote />, []);

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

  // Stable, so the memoised PhotoListView does not re-render for it.
  const memoriesStrip = useMemo(() => <MemoriesStrip />, []);

  return (
    <PhotoListView
      title={t("photos.photos")}
      loading={isLoading || (!filterReady && !filterFailure)}
      photoset={groups}
      idx2hash={photosFlat}
      updateGroups={getAlbums}
      selectable
      emptyStateConfig={emptyStateConfig}
      error={listFailure ?? filterFailure}
      photosetQuery={photosetQuery}
      additionalSubHeader={filterSummary}
      titleBadge={librariesNote}
      headerActions={filterButton}
      banner={memoriesStrip}
    />
  );
}
