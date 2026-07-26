import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "expo-router";
import { mediaHeaders, squareThumbnailUrl, useSearchPhotosQuery } from "@librephotos/api-client";
import { Image } from "expo-image";
import { Icon } from "@/components/Icon";
import { SearchField } from "@/components/SearchField";
import { MirrorGrid } from "@/components/MirrorGrid";
import { useDb, useReactiveQuery } from "@/db/provider";
import { pigPhotoToItem } from "@/lib/pigPhoto";
import {
  clearRecentSearches,
  getRecentSearches,
  offlineSearch,
  pushRecentSearch,
  type OfflineSearchResult,
  type SearchAlbumHit,
  type SearchPersonHit,
} from "@/db/queries/search";
import { useAccessToken } from "@/hooks/use-access-token";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { serverAddress } from "@/lib/apiClient";
import { useTheme, type ThemeColors } from "@/theme";

/** Debounce a changing value by `delayMs`. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const ALBUM_HREF: Record<SearchAlbumHit["kind"], (id: number) => Href> = {
  user: id => `/albums/user/${id}`,
  auto: id => `/albums/events/${id}`,
  thing: id => `/albums/things/${id}`,
  place: id => `/albums/places/${id}`,
  tag: id => `/albums/tags/${id}`,
};

/** Split the flat offline album hits into the frontend's result groups. */
function groupAlbumHits(albums: SearchAlbumHit[]) {
  return {
    albums: albums.filter(a => a.kind === "user" || a.kind === "auto"),
    places: albums.filter(a => a.kind === "place"),
    things: albums.filter(a => a.kind === "thing"),
    tags: albums.filter(a => a.kind === "tag"),
  };
}

/**
 * Search.
 *
 * Semantic/text photo search is server-side (online only); people, albums,
 * places, things and tags always come from the SQLite mirror, so those groups
 * answer instantly and keep working offline. When the device is offline the
 * photo results fall back to a local SQL match over the mirror and the whole
 * result set is clearly labelled "offline results" — never silently degraded.
 *
 * Layout mirrors the web frontend's grouping (people / albums / places /
 * things / tags, then photos). The non-photo groups live in a height-capped
 * scroller above the photo grid so the two never nest virtualized lists.
 */
export function SearchScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDb();
  const isOnline = useOnlineStatus();

  const [text, setText] = useState("");
  const query = useDebounced(text.trim(), 300);

  const recent = useReactiveQuery(d => getRecentSearches(d), []);
  const offline = useReactiveQuery(d => offlineSearch(d, query), [query]);

  const server = useSearchPhotosQuery(query, false);

  // Remember a term once it yields something (either surface).
  useEffect(() => {
    if (!query) return;
    const hasServer = isOnline && (server.data?.photosFlat.length ?? 0) > 0;
    const hasOffline = offline.photos.length + offline.people.length + offline.albums.length > 0;
    if (hasServer || hasOffline) pushRecentSearch(db, query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, server.data, isOnline]);

  const serverItems = useMemo(() => (server.data?.photosFlat ?? []).map(pigPhotoToItem), [server.data]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 10 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: theme.text }}>{t("search.title")}</Text>
        <SearchField
          value={text}
          onChangeText={setText}
          onSubmit={() => query && pushRecentSearch(db, query)}
          placeholder={t("search.placeholder")}
          clearAccessibilityLabel={t("search.clearField")}
        />
      </View>

      {query.length === 0 ? (
        <SearchIntro recent={recent} onPick={setText} onClear={() => clearRecentSearches(db)} />
      ) : isOnline ? (
        <OnlineResults
          query={query}
          offline={offline}
          items={serverItems}
          isLoading={server.isLoading}
          isError={server.isError}
          onRetry={() => void server.refetch()}
        />
      ) : (
        <OfflineResults query={query} offline={offline} />
      )}
    </SafeAreaView>
  );
}

/* ---- empty query: recent searches + a friendly prompt -------------------- */

function SearchIntro({
  recent,
  onPick,
  onClear,
}: {
  recent: string[];
  onPick: (term: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <ScrollView testID="search-intro" contentContainerStyle={{ paddingBottom: 24 }}>
      {recent.length > 0 ? (
        <View style={{ paddingHorizontal: 16 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              minHeight: 44,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="recent" size={15} color={theme.muted} />
              <Text style={{ color: theme.muted, fontWeight: "600", fontSize: 13 }}>{t("search.recent")}</Text>
            </View>
            <Pressable
              testID="search-recent-clear"
              accessibilityRole="button"
              accessibilityLabel={t("search.clearRecent")}
              onPress={onClear}
              hitSlop={12}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("search.clearRecent")}</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {recent.map(term => (
              <Pressable
                key={term}
                testID={`search-recent-${term}`}
                accessibilityRole="button"
                accessibilityLabel={term}
                onPress={() => onPick(term)}
                style={{
                  minHeight: 44,
                  justifyContent: "center",
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                  borderWidth: 1,
                  borderRadius: 22,
                  paddingHorizontal: 16,
                }}
              >
                <Text style={{ color: theme.text, fontSize: 14 }}>{term}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View testID="search-recent-empty" style={{ paddingHorizontal: 16 }}>
          <Text style={{ color: theme.muted, fontSize: 13 }}>{t("search.noRecent")}</Text>
        </View>
      )}

      <View style={{ alignItems: "center", paddingHorizontal: 32, paddingTop: 48, gap: 8 }}>
        <Icon name="search" size={44} color={theme.muted} />
        <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>{t("search.emptyTitle")}</Text>
        <Text style={{ color: theme.muted, fontSize: 13, textAlign: "center" }}>{t("search.emptyHint")}</Text>
      </View>
    </ScrollView>
  );
}

/* ---- results ------------------------------------------------------------ */

function OnlineResults({
  query,
  offline,
  items,
  isLoading,
  isError,
  onRetry,
}: {
  query: string;
  offline: OfflineSearchResult;
  items: ReturnType<typeof pigPhotoToItem>[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View testID="search-results" style={{ flex: 1 }}>
      <ResultBanner
        testID="search-banner-online"
        icon="search"
        color={theme.muted}
        title={t("search.resultsFor", { query })}
      />
      <MirrorMatches offline={offline} />
      <View style={{ flex: 1 }}>
        <SectionLabel title={t("search.sectionPhotos")} />
        <PhotoResults
          testID="search-server-grid"
          items={items}
          isLoading={isLoading}
          isError={isError}
          onRetry={onRetry}
          emptyMessage={t("search.noResults", { query })}
        />
      </View>
    </View>
  );
}

function OfflineResults({ query, offline }: { query: string; offline: OfflineSearchResult }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();
  const headers = useMemo(() => mediaHeaders(token), [token]);
  const empty = offline.photos.length + offline.people.length + offline.albums.length === 0;

  return (
    <View testID="search-offline" style={{ flex: 1 }}>
      <ResultBanner
        testID="search-banner-offline"
        icon="offline"
        color={theme.brand}
        title={t("search.offlineResults")}
        subtitle={t("search.offlineNote")}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {empty ? (
          <View testID="search-offline-empty" style={{ padding: 32, alignItems: "center", gap: 6 }}>
            <Icon name="search" size={32} color={theme.muted} />
            <Text style={{ color: theme.muted, textAlign: "center" }}>{t("search.noResults", { query })}</Text>
          </View>
        ) : null}

        <MirrorMatches offline={offline} capHeight={false} />

        {offline.photos.length > 0 ? (
          <View>
            <SectionLabel title={t("search.sectionPhotos")} count={offline.photos.length} />
            <View
              testID="search-offline-grid"
              style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 14, gap: 4 }}
            >
              {offline.photos.map(p => (
                <Pressable
                  key={p.id}
                  testID={`search-offline-photo-${p.image_hash}`}
                  accessibilityRole="imagebutton"
                  onPress={() => router.push(`/photo/${p.image_hash}`)}
                >
                  <Image
                    style={{ width: 110, height: 110, borderRadius: 6, backgroundColor: theme.card }}
                    source={{ uri: squareThumbnailUrl(base, p.image_hash), headers }}
                    contentFit="cover"
                    cachePolicy="disk"
                  />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * The mirror-backed result groups (people / albums / places / things / tags).
 * Always rendered from SQLite, online or off, so they answer with no latency.
 * `capHeight` bounds them to a slice of the viewport when a photo grid sits
 * below, so the grid never gets squeezed off screen.
 */
function MirrorMatches({ offline, capHeight = true }: { offline: OfflineSearchResult; capHeight?: boolean }) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const groups = useMemo(() => groupAlbumHits(offline.albums), [offline.albums]);
  const hasAny =
    offline.people.length + groups.albums.length + groups.places.length + groups.things.length + groups.tags.length > 0;
  if (!hasAny) return null;

  const body = (
    <>
      {offline.people.length > 0 ? <PeopleStrip people={offline.people} /> : null}
      <AlbumStrip sectionKey="albums" title={t("search.sectionAlbums")} hits={groups.albums} />
      <AlbumStrip sectionKey="places" title={t("search.sectionPlaces")} hits={groups.places} />
      <AlbumStrip sectionKey="things" title={t("search.sectionThings")} hits={groups.things} />
      <AlbumStrip sectionKey="tags" title={t("search.sectionTags")} hits={groups.tags} />
    </>
  );

  if (!capHeight) return <View testID="search-groups">{body}</View>;
  return (
    <ScrollView testID="search-groups" style={{ maxHeight: Math.round(height * 0.38) }}>
      {body}
    </ScrollView>
  );
}

function PeopleStrip({ people }: { people: SearchPersonHit[] }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();
  const headers = useMemo(() => mediaHeaders(token), [token]);

  return (
    <View>
      <SectionLabel title={t("search.sectionPeople")} count={people.length} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
      >
        {people.map(p => (
          <Pressable
            key={p.id}
            testID={`search-person-${p.id}`}
            accessibilityRole="button"
            accessibilityLabel={p.name ?? t("faces.unknown")}
            onPress={() => router.push(`/albums/people/${p.id}`)}
            style={{ alignItems: "center", width: 72 }}
          >
            {p.cover_photo_hash ? (
              <Image
                style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.card }}
                source={{ uri: squareThumbnailUrl(base, p.cover_photo_hash), headers }}
                contentFit="cover"
                cachePolicy="disk"
              />
            ) : (
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: theme.card,
                  borderWidth: 1,
                  borderColor: theme.border,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="people" size={24} color={theme.muted} />
              </View>
            )}
            <Text numberOfLines={1} style={{ color: theme.text, fontSize: 12, marginTop: 4 }}>
              {p.name ?? t("faces.unknown")}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function AlbumStrip({
  sectionKey,
  title,
  hits,
}: {
  sectionKey: string;
  title: string;
  hits: SearchAlbumHit[];
}) {
  const theme = useTheme();
  const router = useRouter();
  if (hits.length === 0) return null;

  return (
    <View testID={`search-group-${sectionKey}`}>
      <SectionLabel title={title} count={hits.length} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      >
        {hits.map(a => (
          <Pressable
            key={`${a.kind}-${a.id}`}
            testID={`search-album-${a.kind}-${a.id}`}
            accessibilityRole="button"
            accessibilityLabel={a.title}
            onPress={() => router.push(ALBUM_HREF[a.kind](a.id))}
            style={{
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: 14,
              borderRadius: 22,
              backgroundColor: theme.card,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          >
            <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14, maxWidth: 200 }}>
              {a.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** The server-backed photo grid plus its loading / error / empty states. */
function PhotoResults({
  items,
  isLoading,
  isError,
  onRetry,
  emptyMessage,
  testID,
}: {
  items: ReturnType<typeof pigPhotoToItem>[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  emptyMessage: string;
  testID: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();

  if (isLoading && items.length === 0) {
    return (
      <View testID={`${testID}-loading`} style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
        <ActivityIndicator color={theme.brand} />
        <Text style={{ color: theme.muted, fontSize: 13 }}>{t("search.searching")}</Text>
      </View>
    );
  }

  if (isError && items.length === 0) {
    return (
      <View
        testID={`${testID}-error`}
        style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 }}
      >
        <Text style={{ color: theme.muted, textAlign: "center" }}>{t("search.error")}</Text>
        <Pressable
          testID={`${testID}-retry`}
          accessibilityRole="button"
          accessibilityLabel={t("common.retry")}
          onPress={onRetry}
          style={{
            minHeight: 44,
            justifyContent: "center",
            paddingHorizontal: 20,
            borderRadius: 22,
            backgroundColor: theme.card,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("common.retry")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <MirrorGrid
      testID={testID}
      items={items}
      serverAddress={base}
      accessToken={token}
      onPressItem={item => item.imageHash && router.push(`/photo/${item.imageHash}`)}
      ListEmptyComponent={
        <View testID={`${testID}-empty`} style={{ padding: 32, alignItems: "center", gap: 6 }}>
          <Icon name="search" size={32} color={theme.muted} />
          <Text style={{ color: theme.muted, textAlign: "center" }}>{emptyMessage}</Text>
        </View>
      }
    />
  );
}

/* ---- small presentational bits ------------------------------------------ */

function SectionLabel({ title, count }: { title: string; count?: number }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8 }}>
      <Text style={{ color: theme.text, fontWeight: "700", fontSize: 14 }}>{title}</Text>
      {count != null ? <Text style={{ color: theme.muted, fontSize: 12 }}>{count}</Text> : null}
    </View>
  );
}

function ResultBanner({
  icon,
  color,
  title,
  subtitle,
  testID,
}: {
  icon: "search" | "offline";
  color: string;
  title: string;
  subtitle?: string;
  testID: string;
}) {
  const theme: ThemeColors = useTheme();
  return (
    <View
      testID={testID}
      style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 4 }}
    >
      <Icon name={icon} size={15} color={color} />
      <View style={{ flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ color, fontWeight: "700", fontSize: 13 }}>
          {title}
        </Text>
        {subtitle ? <Text style={{ color: theme.muted, fontSize: 12 }}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}
