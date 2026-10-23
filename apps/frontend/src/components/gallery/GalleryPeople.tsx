import { Image, Stack, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useGalleryPeopleQuery } from "../../api_client/gallery/hooks";
import faceClasses from "../album/PersonFace.module.css";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { faceImageUrl } from "../facedashboard/personCover";
import { sharerName } from "../sharing/sharerGroups";
import { TileGrid } from "../virtual/TileGrid";
import { useMeasuredTileSizing } from "../virtual/useMeasuredTileSizing";
import { GALLERY_RESERVED_HEIGHT } from "./galleryLayout";

const PLACEHOLDER = "/unknown_user.jpg";
// Under the face: the name (sm), whose photos (xs) and the count (xs).
const CAPTION_HEIGHT = 70;

const columnsFor = (width: number) => {
  if (width < 600) return 2;
  if (width < 900) return 4;
  return 6;
};

/**
 * The gallery's people: the people each photographer named on their photos, for the photographers
 * who share people's names. One entry per photographer and person, so two photographers' "Mia" stay
 * two, each with whose photos they are. A person opens their photos on the timeline.
 */
export function GalleryPeople({ owner }: Readonly<{ owner: number | undefined }>) {
  const { t } = useTranslation();
  const { ref, sizing } = useMeasuredTileSizing({
    columnsFor,
    cellPadding: 8,
    captionHeight: CAPTION_HEIGHT,
    reservedHeight: GALLERY_RESERVED_HEIGHT,
  });
  const query = useGalleryPeopleQuery(owner);
  const failure = useListFailure(query);
  const { data: people, isLoading } = query;

  if (failure) return <ErrorState failure={failure} />;
  if (isLoading) return <PageLoader label={t("gallery.loadingPeople")} />;
  if (!people || people.length === 0) {
    return (
      <Stack align="center" mt="xl">
        <Text c="dimmed" ta="center" maw={420}>
          {t("gallery.noPeople")}
        </Text>
      </Stack>
    );
  }
  return (
    <div ref={ref}>
      <TileGrid
        scrollRestorationId={`gallery-people-${owner ?? "all"}`}
        items={people}
        getKey={person => person.id}
        sizing={sizing}
        renderItem={(person, size) => {
          const photographer = sharerName(person.owner, person.owner.username);
          return (
            <Link to="/public" search={{ owner: person.owner.id, person: person.id }} className={faceClasses.link}>
              <Image
                src={person.face_url ? faceImageUrl(person.face_url) : PLACEHOLDER}
                fallbackSrc={PLACEHOLDER}
                w={size}
                h={size}
                className={faceClasses.face}
                alt={t("gallery.personOf", { name: person.name, photographer })}
              />
            </Link>
          );
        }}
        renderCaption={person => (
          <Stack gap={0} align="center" ta="center">
            <Text size="sm" fw={500} lineClamp={1} title={person.name}>
              {person.name}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {t("gallery.namedBy", { name: sharerName(person.owner, person.owner.username) })}
            </Text>
            <Text size="xs" c="dimmed">
              {t("numberofphotos", { count: person.photo_count, number: person.photo_count })}
            </Text>
          </Stack>
        )}
      />
    </div>
  );
}
