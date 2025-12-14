import { IconPhoto as Photo } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { Photoset, PigPhoto } from "../../api_client/photos/types";
import { EmptyStateConfig, PhotoGroup, PhotoListView } from "../../components/photolist/PhotoListView";
import { useWorkerStatus } from "../../hooks/useWorkerStatus";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

export const Route = createFileRoute("/_protected/")();

export function TimestampPhotos() {
  const { t } = useTranslation();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);
  const { workerRunningJob } = useWorkerStatus();

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
        title: `${t("emptystate.scanning.title")} — ${workerRunningJob.job_type_str}`,
        description: t("emptystate.scanning.refresh"),
        actionLabel: t("emptystate.scanning.refreshButton"),
        onAction: () => refetch(),
        progress: {
          current: workerRunningJob.progress_current ?? 0,
          target: workerRunningJob.progress_target ?? 0,
        },
      };
    }

    return {
      icon: <Photo size={40} />,
      title: t("emptystate.photos.title"),
      description: t("emptystate.photos.description"),
      actionLabel: t("emptystate.goToLibrary"),
      actionLink: "/library",
    };
  }, [t, isScanRunning, workerRunningJob, refetch]);

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

Route.update({ component: TimestampPhotos });
