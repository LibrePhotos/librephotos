import type { PigPhoto } from "@librephotos/api-client";
import { Photoset } from "@librephotos/api-client";
import { Text } from "@mantine/core";
import { IconTrash as Trash } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { useListFailure } from "../../components/common/useListFailure";
import { EmptyTrashButton } from "../../components/photolist/EmptyTrashButton";
import { mediaTypeToBulkQuery, validateMediaSearch } from "../../components/photolist/mediaTypeFilter";
import { NO_PHOTO_GROUP } from "../../components/photolist/photoGroup";
import { PhotoListView } from "../../components/photolist/PhotoListView";
import type { EmptyStateConfig, PigVisibleGroup } from "../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../components/photolist/useMediaTypeFilter";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

export const Route = createFileRoute("/_protected/deleted")({
  component: DeletedPhotos,
  // The media filter (?media=videos): "select all, delete permanently" then
  // reaches only the photos it shows.
  validateSearch: validateMediaSearch,
});

function DeletedPhotos() {
  const { t } = useTranslation();
  const mediaType = useMediaTypeFilter();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  const photosQuery = useFetchDateAlbumsQuery({ photosetType: Photoset.IN_TRASHCAN, mediaType });
  const { data: photosGroupedByDate, isLoading } = photosQuery;
  const listFailure = useListFailure(photosQuery);
  // Days a photo stays in the trash (#2203); 0, or a server without the setting: until emptied.
  const retentionDays = useGetSettingsQuery().data?.trash_retention_days ?? 0;

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  const [group, setGroup] = useState(NO_PHOTO_GROUP);
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.IN_TRASHCAN, mediaType },
    { skip: !group.id }
  );

  const getAlbums = (visibleGroups: PigVisibleGroup<PigPhoto>[]) => {
    visibleGroups.reverse().forEach(photoGroup => {
      const visibleImages = photoGroup.items;
      const firstTempObject = visibleImages.find(i => i.isTemp);
      if (firstTempObject) {
        const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);

        setGroup({ id: photoGroup.id, page });
      }
    });
  };

  const emptyStateConfig: EmptyStateConfig = useMemo(
    () => ({
      icon: <Trash size={40} />,
      title: t("emptystate.deleted.title"),
      description:
        retentionDays > 0
          ? t("emptystate.deleted.descriptionretention", { count: retentionDays })
          : t("emptystate.deleted.description"),
    }),
    [t, retentionDays]
  );

  return (
    <PhotoListView
      title={t("photos.deleted")}
      loading={isLoading}
      icon={Trash}
      additionalSubHeader={
        <Text size="sm" c="dimmed">
          {retentionDays > 0 ? t("trash.retentionOn", { count: retentionDays }) : t("trash.retentionOff")}
        </Text>
      }
      // The whole trash, whatever the media filter shows; it waits for the job it starts.
      headerActions={<EmptyTrashButton shownCount={photosFlat.length} />}
      photoset={photosGroupedByDate ?? []}
      updateGroups={getAlbums}
      idx2hash={photosFlat}
      selectable
      // "Trash is empty" would be wrong when only the filter matches nothing.
      emptyStateConfig={mediaType === "all" ? emptyStateConfig : undefined}
      error={listFailure}
      mediaType={mediaType}
      photosetQuery={{ in_trashcan: true, ...mediaTypeToBulkQuery(mediaType) }}
    />
  );
}
