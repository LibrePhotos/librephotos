import { Photoset } from "@librephotos/api-client";
import { IconUser as User } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDateAlbumDayPages, useFetchDateAlbumsQuery, useFetchPersonQuery } from "../../../api_client/albums/hooks";
import { personNotFoundState } from "../../../components/album/albumNotFound";
import { PersonBirthDateModal } from "../../../components/album/PersonBirthDateModal";
import { PersonHeaderAvatar } from "../../../components/album/PersonHeaderAvatar";
import { PersonHeaderMenu } from "../../../components/album/PersonHeaderMenu";
import { PersonMeta } from "../../../components/album/PersonMeta";
import { PersonShareReviewBanner } from "../../../components/album/PersonShareReviewBanner";
import { usePersonBirthDate } from "../../../components/album/usePersonBirthDate";
import { useListFailure } from "../../../components/common/useListFailure";
import type { CollectionHeader } from "../../../components/photolist/DefaultHeader";
import { mediaTypeToBulkQuery, validateMediaSearch } from "../../../components/photolist/mediaTypeFilter";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { useGroupedPhotos } from "../../../components/photolist/useGroupedPhotos";
import { useMediaTypeFilter } from "../../../components/photolist/useMediaTypeFilter";

export const Route = createFileRoute("/_protected/album/persons/$id")({
  component: AlbumPersonGallery,
  validateSearch: validateMediaSearch,
});

// A person's page heads like an album's: the collection title (34px) beside their face, and the
// photo count alone on the meta line (PersonMeta under it has the days and the birth date).
const PERSON_COLLECTION: CollectionHeader = {};

function AlbumPersonGallery(): React.JSX.Element {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const mediaType = useMediaTypeFilter();
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

  const { groups, photosFlat } = useGroupedPhotos(photosGroupedByDate);

  // Pig reports the day groups on screen; their placeholders name the pages still to load.
  const getAlbums = useDateAlbumDayPages({
    photosetType: Photoset.PERSON,
    person_id: personNumber,
    mediaType,
  });

  return (
    <>
      <PhotoListView
        // Empty while the person loads, under it the header says it is loading
        title={person ? person.name : notFound || personFailure ? t("people") : ""}
        loading={isLoading || personLoading}
        // Their face before the name, as Immich and Google Photos head a person's page
        titleLeading={person ? <PersonHeaderAvatar person={person} /> : undefined}
        collection={person ? PERSON_COLLECTION : undefined}
        headerMenu={
          person ? <PersonHeaderMenu person={person} photos={photosFlat} onBirthDate={birthDate.openFrom} /> : undefined
        }
        // The days of their photos, and the birth date and age under the name (#2751), or "Add birth date"
        additionalSubHeader={
          person ? <PersonMeta person={person} groups={groups} onBirthDate={birthDate.openFrom} /> : undefined
        }
        groupNote={birthDate.groupNote}
        // New photos of a shared person wait for review (#668)
        banner={person ? <PersonShareReviewBanner person={person} /> : undefined}
        error={photosFailure ?? personFailure}
        emptyStateConfig={notFound ? personNotFoundState(t, <User size={40} />) : undefined}
        photoset={groups}
        idx2hash={photosFlat}
        updateGroups={getAlbums}
        selectable
        // No photo filter for a person who is not there
        mediaType={notFound ? undefined : mediaType}
        albumID={id}
        photosetQuery={{ person: personNumber, ...mediaTypeToBulkQuery(mediaType) }}
      />
      {person && (
        <PersonBirthDateModal opened={birthDate.opened} onClose={birthDate.close} person={person} groups={groups} />
      )}
    </>
  );
}
