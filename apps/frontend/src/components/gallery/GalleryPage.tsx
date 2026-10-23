import type { Gallery, GalleryPhotographer } from "@librephotos/api-client";
import { ApiError } from "@librephotos/api-client";
import { Group, Tabs, Text } from "@mantine/core";
import { IconWorld } from "@tabler/icons-react";
import { Navigate } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useIsAuthenticatedQuery } from "../../api_client/auth";
import { useGalleryPeopleQuery, useGalleryPhotographersQuery, useGalleryQuery } from "../../api_client/gallery/hooks";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { PageBody } from "../PageBody";
import { PageHeader } from "../PageHeader";
import { usePublicPageTitle } from "../sharing/usePublicPageTitle";
import { ActiveFilter, OwnerChips } from "./GalleryFilters";
import classes from "./GalleryFilters.module.css";
import { GalleryPeople } from "./GalleryPeople";
import { GalleryPhotographers } from "./GalleryPhotographers";
import { GalleryPlaces } from "./GalleryPlaces";
import { GALLERY_TABS, galleryFilter, type GallerySearch, type GalleryTab } from "./gallerySearch";
import { GalleryTimeline } from "./GalleryTimeline";
import { useNoIndex } from "./useNoIndex";

type Props = Readonly<{
  search: GallerySearch;
  /** Moves to another slice of the gallery: a tab, a photographer, a town, a person. */
  onSearch: (search: GallerySearch) => void;
}>;

/** "1,284 photos from 5 photographers", and a note while only members see it. */
function summary(gallery: Gallery, t: ReturnType<typeof useTranslation>["t"]): string {
  const counts = t("gallery.summary", {
    photos: t("gallery.photoCount", { count: gallery.photo_count }),
    photographers: t("gallery.photographerCount", { count: gallery.photographer_count }),
  });
  return gallery.stage === "members" ? `${counts} · ${t("gallery.membersOnly")}` : counts;
}

/** The person filter's label: their name and whose photos, once the people list knows them. */
function usePersonLabel(search: GallerySearch): string | undefined {
  const { t } = useTranslation();
  const { data: people } = useGalleryPeopleQuery(search.owner, search.person !== undefined);
  if (search.person === undefined) return undefined;
  const person = people?.find(entry => entry.id === search.person);
  return person ? person.name : t("gallery.aPerson");
}

/**
 * The public gallery (#434): the public photos of every user who takes part, as one timeline, the
 * towns they were taken in, the people their photographers named and the photographers. Visitors
 * need no account. A closed gallery (a 404) sends the visitor to the start page, as before.
 */
export function GalleryPage({ search, onSearch }: Props) {
  const { t } = useTranslation();
  const gallery = useGalleryQuery();
  const { data: isAuthenticated } = useIsAuthenticatedQuery();
  const photographersQuery = useGalleryPhotographersQuery();
  const photographers = useMemo(() => photographersQuery.data ?? [], [photographersQuery.data]);
  const byId = useMemo(
    () => new Map<number, GalleryPhotographer>(photographers.map(photographer => [photographer.id, photographer])),
    [photographers]
  );
  const failure = useListFailure(gallery);
  const personLabel = usePersonLabel(search);
  usePublicPageTitle(t("gallery.title"));
  useNoIndex(gallery.data?.indexable !== true);

  // Closed: a visitor goes to the sign-in page, a user to their timeline, as before the gallery.
  if (gallery.error instanceof ApiError && gallery.error.status === 404) {
    return <Navigate to={isAuthenticated ? "/" : "/login"} replace />;
  }
  if (failure) return <ErrorState failure={failure} />;
  if (!gallery.data) return <PageLoader />;

  const tab: GalleryTab = search.tab ?? "timeline";
  const filter = galleryFilter(search);
  const changeTab = (value: string | null) => {
    const next = GALLERY_TABS.find(name => name === value) ?? "timeline";
    // Places, people and photographers list the photographer filter only.
    onSearch({ owner: search.owner, ...(next === "timeline" ? {} : { tab: next }) });
  };

  return (
    <>
      <PageHeader icon={IconWorld} title={t("gallery.title")} subtitle={summary(gallery.data, t)} />
      <PageBody gap={0}>
        <Tabs value={tab} onChange={changeTab} keepMounted={false}>
          <Tabs.List className={classes.tabList}>
            {GALLERY_TABS.map(name => (
              <Tabs.Tab key={name} value={name}>
                {t(`gallery.tab_${name}`)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {tab !== "photographers" && (
            <OwnerChips
              photographers={photographers}
              owner={search.owner}
              onChange={owner => onSearch({ ...search, owner, person: undefined })}
            />
          )}
          {tab === "timeline" && (search.place !== undefined || personLabel !== undefined) && (
            <Group gap="xs" pb="xs">
              {search.place !== undefined && (
                <ActiveFilter
                  label={t("gallery.takenIn", { place: search.place })}
                  onRemove={() => onSearch({ ...search, place: undefined })}
                />
              )}
              {personLabel !== undefined && (
                <ActiveFilter label={personLabel} onRemove={() => onSearch({ ...search, person: undefined })} />
              )}
            </Group>
          )}
          <Tabs.Panel value="timeline">
            <GalleryTimeline filter={filter} filtered={Object.keys(filter).length > 0} />
          </Tabs.Panel>
          <Tabs.Panel value="places">
            <GalleryPlaces owner={search.owner} photographers={byId} />
          </Tabs.Panel>
          <Tabs.Panel value="people">
            <GalleryPeople owner={search.owner} />
          </Tabs.Panel>
          <Tabs.Panel value="photographers" pt="md">
            {photographers.length === 0 ? (
              <Text c="dimmed" ta="center" mt="xl">
                {t("gallery.noPhotographers")}
              </Text>
            ) : (
              <GalleryPhotographers photographers={photographers} />
            )}
          </Tabs.Panel>
        </Tabs>
      </PageBody>
    </>
  );
}
