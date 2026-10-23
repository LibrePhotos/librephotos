import type { PigPhoto } from "@librephotos/api-client";
import { Photoset } from "@librephotos/api-client";
import { IconUser as User } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery, useFetchPersonQuery } from "../../../api_client/albums/hooks";
import { personNotFoundState } from "../../../components/album/albumNotFound";
import { PersonBirthDateLine } from "../../../components/album/PersonBirthDateLine";
import { PersonBirthDateModal } from "../../../components/album/PersonBirthDateModal";
import { PersonHeaderMenu } from "../../../components/album/PersonHeaderMenu";
import { PersonShareReviewBanner } from "../../../components/album/PersonShareReviewBanner";
import { usePersonBirthDate } from "../../../components/album/usePersonBirthDate";
import { useListFailure } from "../../../components/common/useListFailure";
import { mediaTypeToBulkQuery, validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import { NO_PHOTO_GROUP } from "../../../components/photolist/photoGroup";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import type { PhotoGroup, PigVisibleGroup } from "../../../components/photolist/PhotoListView";
import { useMediaTypeFilter } from "../../../components/photolist/useMediaTypeFilter";
import { getPhotosFlatFromGroupedByDate } from "../../../util/util";

export const Route = createFileRoute("/_protected/album/persons/$id")({
  component: AlbumPersonGallery,
  validateSearch: validateMediaSearch,
});

function AlbumPersonGallery(): React.JSX.Element {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const mediaType = useMediaTypeFilter();
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);
  const personId = Number(id);
  // The person itself, not a search of the People list: that missed anyone past its first page
  // and showed "Loading" for good for a deleted person (#2207).
  const personQuery = useFetchPersonQuery(personId);
  const { data: person, isLoading: personLoading } = personQuery;
  const notFound = person === null || !Number.isInteger(personId) || personId <= 0;
  const birthDate = usePersonBirthDate(person);
  // The id as the photo queries take it
  const personNumber = id ? +id : undefined;

  const photosQuery = useFetchDateAlbumsQuery({
    photosetType: Photoset.PERSON,
    person_id: personNumber,
    mediaType,
  });
  const { data: photosGroupedByDate, isLoading } = photosQuery;
  const photosFailure = useListFailure(photosQuery);
  const personFailure = useListFailure(personQuery);

  useEffect(() => {
    if (photosGroupedByDate) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosGroupedByDate));
  }, [photosGroupedByDate]);

  // No day album asked for yet: the query below stays off until one is
  const [group, setGroup] = useState<PhotoGroup>(NO_PHOTO_GROUP);
  useFetchDateAlbumQuery(
    {
      album_date_id: group.id,
      page: group.page,
      photosetType: Photoset.PERSON,
      person_id: personNumber,
      mediaType,
    },
    { skip: !group.id }
  );

  const getAlbums = (visibleGroups: PigVisibleGroup<PigPhoto>[]) => {
    visibleGroups.reverse().forEach(photoGroup => {
      const visibleImages = photoGroup.items;
      const firstTempObject = visibleImages.find(i => i.isTemp);
      if (firstTempObject !== undefined) {
        const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);

        setGroup({ id: photoGroup.id, page });
      }
    });
  };

  return (
    <>
      <PhotoListView
        // Empty while the person loads, under it the header says it is loading
        title={person ? person.name : notFound || personFailure ? t("people") : ""}
        loading={isLoading || personLoading}
        icon={User}
        headerActions={
          person ? <PersonHeaderMenu person={person} photos={photosFlat} onBirthDate={birthDate.openFrom} /> : undefined
        }
        // The birth date and age under the name, and the age beside each day (#2751): none without one
        additionalSubHeader={
          person?.birth_date ? (
            <PersonBirthDateLine name={person.name} birthDate={person.birth_date} onEdit={birthDate.openFrom} />
          ) : undefined
        }
        groupNote={birthDate.groupNote}
        // New photos of a shared person wait for review (#668)
        banner={person ? <PersonShareReviewBanner person={person} /> : undefined}
        error={photosFailure ?? personFailure}
        emptyStateConfig={notFound ? personNotFoundState(t, <User size={40} />) : undefined}
        photoset={photosGroupedByDate ?? []}
        idx2hash={photosFlat}
        updateGroups={getAlbums}
        selectable
        // No photo filter for a person who is not there
        mediaType={notFound ? undefined : mediaType}
        albumID={id}
        photosetQuery={{ person: personNumber, ...mediaTypeToBulkQuery(mediaType) }}
      />
      {person && (
        <PersonBirthDateModal
          opened={birthDate.opened}
          onClose={birthDate.close}
          person={person}
          groups={photosGroupedByDate ?? []}
        />
      )}
    </>
  );
}
