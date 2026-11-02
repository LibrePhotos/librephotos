import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "expo-router";
import { ExploreSection, type ExploreItem } from "@/components/ExploreSection";
import { FloatingTopBar, useTopBarInset } from "@/components/FloatingTopBar";
import { Icon, type IconName } from "@/components/Icon";
import { filterCounts, type PhotoFilter } from "@/db/queries/filters";
import { LIBRARY_VIEWS, QUICK_VIEWS, libraryHref } from "@/features/photos/libraryViews";
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
import { allSyncState, SYNC_ENTITIES, type SyncEntity } from "@/db/queries/sync-state";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useTheme, type ThemeColors } from "@/theme";

const CARD_PREVIEW = 12;
const AVATAR_PREVIEW = 16;

type ExploreData = {
  user: ExploreItem[];
  people: ExploreItem[];
  things: ExploreItem[];
  tags: ExploreItem[];
  places: ExploreItem[];
  events: ExploreItem[];
  /** Photo counts of the library views (favorites, videos, trash, …). */
  counts: Record<PhotoFilter, number>;
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
    const entity = SYNC_ENTITIES.find((e) => e === row.entity);
    if (entity && row.last_full_sync != null) seeded.add(entity);
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
    counts: filterCounts(db, LIBRARY_VIEWS.map((v) => v.filter)),
    seeding,
  };
}

/**
 * The Collections tab. No title bar: quick tiles for the most used views
 * (favorites, videos, recently added, trash) start at the top, then an
 * "Explore" hub that mirrors the web frontend's
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
  const topInset = useTopBarInset();
  const router = useRouter();
  const moreViews = LIBRARY_VIEWS.filter((v) => !QUICK_VIEWS.includes(v.filter));

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView testID="explore-screen" contentContainerStyle={{ paddingTop: topInset, paddingBottom: 32 }}>
        <View testID="collections-quick" style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 16, paddingBottom: 8 }}>
          {QUICK_VIEWS.map((filter) => {
            const view = LIBRARY_VIEWS.find((v) => v.filter === filter);
            if (!view) return null;
            return (
              <QuickTile
                key={filter}
                testID={`collections-quick-${filter}`}
                icon={view.icon}
                label={t(view.titleKey)}
                count={data.counts[filter]}
                onPress={() => router.push(libraryHref(filter))}
                theme={theme}
              />
            );
          })}
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

        {/* Hidden while empty: an empty strip is noise on a phone. */}
        {data.things.length > 0 || data.seeding.has("thing_album") ? (
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
        ) : null}

        {data.tags.length > 0 || data.seeding.has("tag_album") ? (
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
        ) : null}

        {data.places.length > 0 || data.seeding.has("place_album") ? (
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
        ) : null}

        {data.events.length > 0 || data.seeding.has("auto_album") ? (
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
        ) : null}

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

        <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700", paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 }}>
          {t("collections.more")}
        </Text>
        <View style={{ marginHorizontal: 16, backgroundColor: theme.card, borderRadius: 14, overflow: "hidden" }}>
          {moreViews.map((view) => (
            <MoreRow
              key={view.filter}
              testID={`collections-more-${view.filter}`}
              icon={view.icon}
              label={t(view.titleKey)}
              count={data.counts[view.filter]}
              onPress={() => router.push(libraryHref(view.filter))}
              theme={theme}
            />
          ))}
          <MoreRow
            testID="collections-more-sharing"
            icon="sharing"
            label={t("collections.sharing")}
            onPress={() => router.push("/sharing")}
            theme={theme}
            last
          />
        </View>
      </ScrollView>
      <FloatingTopBar />
    </View>
  );
}

function QuickTile({
  icon,
  label,
  count,
  onPress,
  theme,
  testID,
}: {
  icon: IconName;
  label: string;
  count: number;
  onPress: () => void;
  theme: ThemeColors;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{ flexBasis: "47%", flexGrow: 1, backgroundColor: theme.card, borderRadius: 14, padding: 14, gap: 10 }}
    >
      <Icon name={icon} size={22} color={theme.brand} />
      <View>
        <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15 }}>{label}</Text>
        <Text style={{ color: theme.muted, fontSize: 12 }}>{count}</Text>
      </View>
    </Pressable>
  );
}

function MoreRow({
  icon,
  label,
  count,
  onPress,
  theme,
  testID,
  last = false,
}: {
  icon: IconName;
  label: string;
  count?: number;
  onPress: () => void;
  theme: ThemeColors;
  testID: string;
  last?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.border,
      }}
    >
      <Icon name={icon} size={20} color={theme.text} />
      <Text style={{ color: theme.text, fontWeight: "600", flex: 1 }}>{label}</Text>
      {count != null ? <Text style={{ color: theme.muted }}>{count}</Text> : null}
      <Icon name="viewAll" size={18} color={theme.muted} />
    </Pressable>
  );
}
