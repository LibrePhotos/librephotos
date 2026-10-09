import { IconPhoto as Photo } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { Photoset, PigPhoto } from "../../api_client/photos/types";
import { EmptyStateConfig, PhotoGroup, PhotoListView } from "../../components/photolist/PhotoListView";
import { useHasNoScanDirectory } from "../../components/photolist/useScanEmptyStateAction";
import { useWorkerStatus } from "../../hooks/useWorkerStatus";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

export const Route = createFileRoute("/_protected/")({
  component: TimestampPhotos,
});

function TimestampPhotos() {
  const { t } = useTranslation();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);
  const { workerRunningJob } = useWorkerStatus();
  // Only an admin can set a user's scan folder, so "Go to Library" would be a
  // dead end; point at what others shared instead.
  const hasNoScanDirectory = useHasNoScanDirectory();

  const { data: photosGroupedByDate, isLoading, refetch } = useFetchDateAlbumsQuery({ photosetType: Photoset.NONE });

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState({} as PhotoGroup);
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.NONE },
    { skip: !group.id }
  );

  const getAlbums = (visibleGroups: any) => {
    visibleGroups.reverse().forEach((photoGroup: any) => {
      const visibleImages = photoGroup.items;
      if (visibleImages.filter((i: any) => i.isTemp).length > 0) {
        const firstTempObject = visibleImages.filter((i: any) => i.isTemp)[0];
        const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);

        setGroup({ id: photoGroup.id, page });
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
  }, [t, isScanRunning, workerRunningJob, refetch, hasNoScanDirectory]);

  return (
    <PhotoListView
      title={t("photos.photos")}
      loading={isLoading}
      icon={<Photo size={50} />}
      photoset={photosGroupedByDate ?? []}
      idx2hash={photosFlat}
      updateGroups={getAlbums}
      selectable
      emptyStateConfig={emptyStateConfig}
      photosetQuery={{}}
    />
  );
}
