import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { Href } from "expo-router";
import { ExploreSection, type ExploreItem } from "@/components/ExploreSection";
import { Icon } from "@/components/Icon";
import { useReactiveQuery } from "@/db/provider";
import type { AppDatabase } from "@/db/types";
import {
  autoAlbums,
  firstCoverHash,
  placeAlbumsList,
  tagAlbumsList,
  thingAlbumsList,
  userAlbums,
} from "@/db/queries/albums";
import { people } from "@/db/queries/people";
import { allSyncState, type SyncEntity } from "@/db/queries/sync-state";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useTheme } from "@/theme";

const CARD_PREVIEW = 12;
const AVATAR_PREVIEW = 16;

type ExploreData = {
  user: ExploreItem[];
  people: ExploreItem[];
  things: ExploreItem[];
  tags: ExploreItem[];
  places: ExploreItem[];
  events: ExploreItem[];
  /** Entities whose first full sync has not finished yet → show skeletons. */
  seeding: Set<SyncEntity>;
};

/**
 * Read every hub section in one pass over the mirror. A single reactive query
 * keeps the whole screen consistent (one re-run per DB commit) and keeps the
 * screen offline-capable: nothing here touches the network.
 *
 * Only `LIMIT`-worth of rows are needed for the strips, but the *counts* come
 * from the same lists, which is what the frontend shows too ("N albums" is the
 * number of albums, not of photos).
 */
export function readExplore(db: AppDatabase, labels: { unknownPerson: string }): ExploreData {
  const seeded = new Set<SyncEntity>();
  for (const row of allSyncState(db)) {
    if (row.last_full_sync != null) seeded.add(row.entity as SyncEntity);
  }
  const seeding = new Set<SyncEntity>(
    (["user_album", "person", "thing_album", "tag_album", "place_album", "auto_album"] as const).filter(
      e => !seeded.has(e)
    )
  );

  return {
    user: userAlbums(db).map(a => ({
      id: a.id,
      title: a.title,
      coverHash: a.cover_hash,
      photoCount: a.photo_count,
      href: `/albums/user/${a.id}` as Href,
    })),
    people: people(db).map(p => ({
      id: p.id,
      title: p.name ?? labels.unknownPerson,
      coverHash: p.cover_photo_hash,
      href: `/albums/people/${p.id}` as Href,
    })),
    things: thingAlbumsList(db).map(a => ({
      id: a.id,
      title: a.title,
      coverHash: firstCoverHash(a.cover_hashes),
      photoCount: a.photo_count,
      href: `/albums/things/${a.id}` as Href,
    })),
    tags: tagAlbumsList(db).map(a => ({
      id: a.id,
      title: a.title,
      coverHash: firstCoverHash(a.cover_hashes),
      photoCount: a.photo_count,
      href: `/albums/tags/${a.id}` as Href,
    })),
    places: placeAlbumsList(db).map(a => ({
      id: a.id,
      title: a.title,
      coverHash: firstCoverHash(a.cover_hashes),
      photoCount: a.photo_count,
      href: `/albums/places/${a.id}` as Href,
    })),
    events: autoAlbums(db).map(a => ({
      id: a.id,
      title: a.title,
      coverHash: a.cover_hash,
      photoCount: a.photo_count,
      href: `/albums/events/${a.id}` as Href,
    })),
    seeding,
  };
}

/**
 * The Albums tab: an "Explore" hub that mirrors the web frontend's
 * `/album` route — one section per category (My Albums, People, Things, Tags,
 * Places, Auto Created Albums, Folders), each with a category icon, a live
 * count, a "View all ›" affordance and a horizontal strip of preview cards.
 *
 * Everything except Folders renders from the SQLite mirror, so the screen is
 * fully usable offline. Folders are a server-side directory walk with no mirror
 * table, so that row degrades to an explanatory notice rather than a broken
 * strip.
 */
export function ExploreScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isOnline = useOnlineStatus();
  const unknownPerson = t("faces.unknown");
  const data = useReactiveQuery(db => readExplore(db, { unknownPerson }), [unknownPerson]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <ScrollView testID="explore-screen" contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
          <Icon name="explore" size={32} color={theme.text} />
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: 24, fontWeight: "700", color: theme.text }}>{t("explore.title")}</Text>
            <Text style={{ fontSize: 13, color: theme.muted }}>{t("explore.subtitle")}</Text>
          </View>
        </View>

        <ExploreSection
          sectionKey="user"
          title={t("explore.myAlbums")}
          icon="myAlbums"
          countLabel={t("explore.albumCount", { count: data.user.length })}
          viewAllHref="/albums/user/all"
          items={data.user}
          isSeeding={data.seeding.has("user_album")}
          emptyMessage={t("explore.noAlbums")}
          maxItems={CARD_PREVIEW}
        />

        <ExploreSection
          sectionKey="people"
          title={t("explore.people")}
          icon="people"
          countLabel={t("explore.peopleCount", { count: data.people.length })}
          viewAllHref="/albums/people/all"
          items={data.people}
          isSeeding={data.seeding.has("person")}
          emptyMessage={t("explore.noPeople")}
          action={{ label: t("explore.manageFaces"), icon: "faces", href: "/profile/faces" }}
          variant="avatar"
          maxItems={AVATAR_PREVIEW}
        />

        <ExploreSection
          sectionKey="things"
          title={t("explore.things")}
          icon="things"
          countLabel={t("explore.albumCount", { count: data.things.length })}
          viewAllHref="/albums/things/all"
          items={data.things}
          isSeeding={data.seeding.has("thing_album")}
          emptyMessage={t("explore.noThings")}
          maxItems={CARD_PREVIEW}
        />

        <ExploreSection
          sectionKey="tags"
          title={t("explore.tags")}
          icon="tags"
          countLabel={t("explore.albumCount", { count: data.tags.length })}
          viewAllHref="/albums/tags/all"
          items={data.tags}
          isSeeding={data.seeding.has("tag_album")}
          emptyMessage={t("explore.noTags")}
          maxItems={CARD_PREVIEW}
        />

        <ExploreSection
          sectionKey="places"
          title={t("explore.places")}
          icon="places"
          countLabel={t("explore.albumCount", { count: data.places.length })}
          viewAllHref="/albums/places/all"
          items={data.places}
          isSeeding={data.seeding.has("place_album")}
          emptyMessage={t("explore.noPlaces")}
          maxItems={CARD_PREVIEW}
        />

        <ExploreSection
          sectionKey="events"
          title={t("explore.autoAlbums")}
          icon="events"
          countLabel={t("explore.albumCount", { count: data.events.length })}
          viewAllHref="/albums/events/all"
          items={data.events}
          isSeeding={data.seeding.has("auto_album")}
          emptyMessage={t("explore.noEvents")}
          maxItems={CARD_PREVIEW}
        />

        <ExploreSection
          sectionKey="folders"
          title={t("explore.folders")}
          icon="folders"
          countLabel={isOnline ? t("explore.foldersOnServer") : t("common.offline")}
          viewAllHref="/albums/folders/root"
          items={[]}
          emptyMessage={t("explore.foldersOnline")}
          notice={isOnline ? t("explore.foldersOnline") : t("explore.foldersOffline")}
          maxItems={CARD_PREVIEW}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
