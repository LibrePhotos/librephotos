import type { SharedPerson } from "@librephotos/api-client";
import { Image, Stack, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedPeopleWithMeQuery } from "../../api_client/photos/hooks";
import faceClasses from "../album/PersonFace.module.css";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { faceImageUrl } from "../facedashboard/personCover";
import { TileGrid } from "../virtual/TileGrid";
import { useMeasuredTileSizing } from "../virtual/useMeasuredTileSizing";
import { SHARED_TAB_RESERVED_HEIGHT } from "./sharedWithMeLayout";
import { sharerName } from "./sharerGroups";

const PLACEHOLDER = "/unknown_user.jpg";
// Under the face: the name (sm), who shared it and the count (xs each).
const CAPTION_HEIGHT = 70;
// The hint above the grid.
const HINT_HEIGHT = 40;

const columnsFor = (width: number) => {
  if (width < 600) return 2;
  if (width < 900) return 4;
  return 6;
};

/** "Mom, shared by Alice": the name the owner gave, and whose person it is. */
export function sharedPersonLabel(person: SharedPerson, by: (owner: string) => string) {
  return { name: person.name, owner: by(sharerName(person.owner, person.owner.username)) };
}

/**
 * Sharing > Shared with you > People (#2722): the people the owners named on the photos they
 * shared with you. One entry per owner and person, so two owners' "Mom" stay apart. Owners who do
 * not share people's names are not listed at all.
 */
export function PeopleSharedWithMe() {
  const { t } = useTranslation();
  const { ref, sizing } = useMeasuredTileSizing({
    columnsFor,
    cellPadding: 8,
    captionHeight: CAPTION_HEIGHT,
    reservedHeight: SHARED_TAB_RESERVED_HEIGHT + HINT_HEIGHT,
  });
  const query = useFetchSharedPeopleWithMeQuery();
  const listFailure = useListFailure(query);
  const { data: people, isLoading } = query;
  const by = (owner: string) => t("sharing.sharedBy", { name: owner });

  if (listFailure) return <ErrorState failure={listFailure} />;
  if (isLoading) return <PageLoader label={t("sharing.loadingPeople")} />;

  return (
    <div ref={ref}>
      <Text size="sm" c="dimmed" mb="xs" h={HINT_HEIGHT - 8}>
        {t("sharing.sharedPeopleHint")}
      </Text>
      {!people || people.length === 0 ? (
        <Stack align="center" mt="xl">
          <Text c="dimmed" ta="center" maw={420}>
            {t("sharing.noPeopleSharedWithYou")}
          </Text>
        </Stack>
      ) : (
        <TileGrid
          scrollRestorationId="sharing-people-with-me"
          items={people}
          getKey={person => person.id}
          sizing={sizing}
          renderItem={(person, size) => {
            const label = sharedPersonLabel(person, by);
            return (
              <Link
                to="/sharing/withme/people/$personId"
                params={{ personId: String(person.id) }}
                className={faceClasses.link}
              >
                <Image
                  src={person.face_url ? faceImageUrl(person.face_url) : PLACEHOLDER}
                  fallbackSrc={PLACEHOLDER}
                  w={size}
                  h={size}
                  className={faceClasses.face}
                  alt={`${label.name}, ${label.owner}`}
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
                {sharedPersonLabel(person, by).owner}
              </Text>
              <Text size="xs" c="dimmed">
                {t("numberofphotos", { count: person.photo_count, number: person.photo_count })}
              </Text>
            </Stack>
          )}
        />
      )}
    </div>
  );
}
