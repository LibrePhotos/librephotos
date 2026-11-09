import type { GalleryFilter } from "@librephotos/api-client";
import { IconWorld } from "@tabler/icons-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useGalleryDayPages, useGalleryDaysQuery } from "../../api_client/gallery/hooks";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";
import { EmptyState } from "../common/EmptyState";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { OwnerMarksContext } from "../photolist/ownerMarks";
import { PhotoListView } from "../photolist/PhotoListView";

type Props = Readonly<{ filter: GalleryFilter; filtered: boolean }>;

/**
 * The gallery's timeline: the days of every photographer who shares dates, newest first, then the
 * photos of the ones who do not (and of photos without a date) in one group with no date. Every
 * tile says whose photo it is. Read-only: nothing to select.
 */
export function GalleryTimeline({ filter, filtered }: Props) {
  const { t } = useTranslation();
  const query = useGalleryDaysQuery(filter);
  const failure = useListFailure(query);
  const days = useMemo(() => query.data ?? [], [query.data]);
  const idx2hash = useMemo(() => getPhotosFlatFromGroupedByDate(days), [days]);

  // Pig reports the day groups on screen; their placeholders name the pages still to load.
  const updateGroups = useGalleryDayPages(filter);

  if (failure) return <ErrorState failure={failure} />;
  if (!query.isLoading && days.length === 0) {
    return (
      <EmptyState
        icon={<IconWorld size={40} />}
        title={t(filtered ? "gallery.noMatchTitle" : "gallery.emptyTitle")}
        description={t(filtered ? "gallery.noMatchDescription" : "gallery.emptyDescription")}
      />
    );
  }
  return (
    <OwnerMarksContext value>
      <PhotoListView
        title={t("gallery.title")}
        loading={query.isLoading}
        photoset={days}
        idx2hash={idx2hash}
        updateGroups={updateGroups}
        isPublic
        // Under the gallery's own header and tabs.
        header={null}
        selectable={false}
      />
    </OwnerMarksContext>
  );
}
