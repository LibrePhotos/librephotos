import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { mediaHeaders, squareThumbnailUrl, useSearchPhotosQuery } from "@librephotos/api-client";
import { Image } from "expo-image";
import { OnlinePhotoGrid } from "@/components/OnlinePhotoGrid";
import { useDb, useReactiveQuery } from "@/db/provider";
import { pigPhotoToItem } from "@/lib/pigPhoto";
import {
  clearRecentSearches,
  getRecentSearches,
  offlineSearch,
  pushRecentSearch,
  type SearchAlbumHit,
} from "@/db/queries/search";
import { useAccessToken } from "@/hooks/use-access-token";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { serverAddress } from "@/lib/apiClient";
import { useTheme } from "@/theme";

/** Debounce a changing value by `delayMs`. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const ALBUM_HREF: Record<SearchAlbumHit["kind"], (id: number) => string> = {
  user: (id) => `/albums/user/${id}`,
  auto: (id) => `/albums/events/${id}`,
  thing: (id) => `/albums/things/${id}`,
  place: (id) => `/albums/places/${id}`,
  tag: (id) => `/albums/tags/${id}`,
};

/**
 * Search: semantic/text search is server-side (online). When offline we fall
 * back to a local SQL search over the mirror (search_location, person names,
 * album titles, date terms), clearly labeled "offline results". Recent searches
 * persist in app_meta.
 */
export function SearchScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDb();
  const token = useAccessToken();
  const base = serverAddress();
  const isOnline = useOnlineStatus();
  const headers = useMemo(() => mediaHeaders(token), [token]);

  const [text, setText] = useState("");
  const query = useDebounced(text.trim(), 300);

  const recent = useReactiveQuery((d) => getRecentSearches(d), []);
  const offline = useReactiveQuery((d) => offlineSearch(d, query), [query]);

  const server = useSearchPhotosQuery(query, false);

  // Remember a term once it yields something (either surface).
  useEffect(() => {
    if (!query) return;
    const hasServer = isOnline && (server.data?.photosFlat.length ?? 0) > 0;
    const hasOffline = offline.photos.length + offline.people.length + offline.albums.length > 0;
    if (hasServer || hasOffline) pushRecentSearch(db, query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, server.data, isOnline]);

  const serverItems = useMemo(
    () => (server.data?.photosFlat ?? []).map(pigPhotoToItem),
    [server.data]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: theme.text }}>{t("search.title")}</Text>
        <TextInput
          testID="search-input"
          value={text}
          onChangeText={setText}
          placeholder={t("search.placeholder")}
          placeholderTextColor={theme.muted}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => query && pushRecentSearch(db, query)}
          style={{
            color: theme.text,
            backgroundColor: theme.card,
            borderColor: theme.border,
            borderWidth: 1,
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        />
      </View>

      {query.length === 0 ? (
        <RecentSearches
          recent={recent}
          onPick={setText}
          onClear={() => clearRecentSearches(db)}
        />
      ) : isOnline ? (
        <View style={{ flex: 1 }}>
          <Text style={{ paddingHorizontal: 16, paddingBottom: 6, color: theme.muted, fontWeight: "600" }}>
            {t("search.serverResults")}
          </Text>
          <OnlinePhotoGrid
            testID="search-server-grid"
            items={serverItems}
            isLoading={server.isLoading}
            isError={server.isError}
            emptyMessage={t("search.noResults", { query })}
          />
        </View>
      ) : (
        <OfflineResults db={db} query={query} offline={offline} base={base} headers={headers} router={router} theme={theme} albumHref={ALBUM_HREF} />
      )}
    </SafeAreaView>
  );
}

function RecentSearches({
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
  if (recent.length === 0) return <View testID="search-recent-empty" style={{ flex: 1 }} />;
  return (
    <View style={{ paddingHorizontal: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Text style={{ color: theme.muted, fontWeight: "600" }}>{t("search.recent")}</Text>
        <Pressable testID="search-recent-clear" onPress={onClear} hitSlop={8}>
          <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("search.clearRecent")}</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {recent.map((term) => (
          <Pressable
            key={term}
            testID={`search-recent-${term}`}
            onPress={() => onPick(term)}
            style={{ backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 }}
          >
            <Text style={{ color: theme.text }}>{term}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function OfflineResults({
  db,
  query,
  offline,
  base,
  headers,
  router,
  theme,
  albumHref,
}: {
  db: ReturnType<typeof useDb>;
  query: string;
  offline: ReturnType<typeof offlineSearch>;
  base: string;
  headers: Record<string, string>;
  router: ReturnType<typeof useRouter>;
  theme: ReturnType<typeof useTheme>;
  albumHref: typeof ALBUM_HREF;
}) {
  const { t } = useTranslation();
  const empty = offline.photos.length + offline.people.length + offline.albums.length === 0;
  void db;

  return (
    <ScrollView testID="search-offline" style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text style={{ color: theme.brand, fontWeight: "700" }}>{t("search.offlineResults")}</Text>
        <Text style={{ color: theme.muted, fontSize: 12 }}>{t("search.offlineNote")}</Text>
      </View>

      {empty ? (
        <View testID="search-offline-empty" style={{ padding: 32, alignItems: "center" }}>
          <Text style={{ color: theme.muted }}>{t("search.noResults", { query })}</Text>
        </View>
      ) : null}

      {offline.people.length > 0 ? (
        <Section title={t("search.sectionPeople")} theme={theme}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 16 }}>
            {offline.people.map((p) => (
              <Pressable
                key={p.id}
                testID={`search-person-${p.id}`}
                onPress={() => router.push(`/albums/people/${p.id}`)}
                style={{ alignItems: "center", width: 72 }}
              >
                <Image
                  style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.card }}
                  source={p.cover_photo_hash ? { uri: squareThumbnailUrl(base, p.cover_photo_hash), headers } : undefined}
                  contentFit="cover"
                  cachePolicy="disk"
                />
                <Text numberOfLines={1} style={{ color: theme.text, fontSize: 12, marginTop: 4 }}>
                  {p.name ?? "Unknown"}
                </Text>
              </Pressable>
            ))}
          </View>
        </Section>
      ) : null}

      {offline.albums.length > 0 ? (
        <Section title={t("search.sectionAlbums")} theme={theme}>
          {offline.albums.map((a) => (
            <Pressable
              key={`${a.kind}-${a.id}`}
              testID={`search-album-${a.kind}-${a.id}`}
              onPress={() => router.push(albumHref[a.kind](a.id))}
              style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: 1 }}
            >
              <Text style={{ color: theme.text }}>{a.title}</Text>
            </Pressable>
          ))}
        </Section>
      ) : null}

      {offline.photos.length > 0 ? (
        <Section title={t("search.sectionPhotos")} theme={theme}>
          <View testID="search-offline-grid" style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 14, gap: 4 }}>
            {offline.photos.map((p) => (
              <Pressable
                key={p.id}
                testID={`search-offline-photo-${p.image_hash}`}
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
        </Section>
      ) : null}
    </ScrollView>
  );
}

function Section({ title, theme, children }: { title: string; theme: ReturnType<typeof useTheme>; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ paddingHorizontal: 16, paddingVertical: 6, color: theme.muted, fontWeight: "600", fontSize: 13 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}
