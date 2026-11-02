import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { TimelineList } from "@/components/TimelineList";
import { FloatingTopBar, TopBarButton, useTopBarInset } from "@/components/FloatingTopBar";
import { useUserSelfDetailsQuery } from "@librephotos/api-client";
import { isTimelineFilterActive, timelineBuckets } from "@/db/queries/timeline";
import { TimelineScrubber } from "@/components/TimelineScrubber";
import { photosBefore, scrubberIndex } from "@/components/scrubberMath";
import { TimelineFilterSheet } from "./TimelineFilterSheet";
import { fromServerDefault, useTimelineFilterStore } from "./timelineFilter";
import type { GridItem } from "@/components/PhotoTile";
import { MemoriesCard } from "@/features/memories/MemoriesCard";
import { useMirrorTimeline } from "./useMirrorTimeline";
import { useGridSelection } from "@/features/selection/useGridSelection";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { useDb, useReactiveQuery } from "@/db/provider";
import { useAuthStore } from "@/stores/auth";
import { runSync } from "@/sync/run";
import { useTheme } from "@/theme";
import { photoRoute } from "@/features/viewer/route";

/**
 * The photos timeline, rendered from SQLite via a live query (day section
 * headers + 3-column grid). Pull-to-refresh runs a forced delta sync (not a full
 * re-seed). Tapping a photo opens the full-screen viewer by hash.
 */
export function TimelineScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDb();
  const token = useAccessToken();
  const base = serverAddress();
  const userId = useAuthStore((s) => s.userId);
  const user = useUserSelfDetailsQuery(userId ?? undefined);
  const savedDefault = useMemo(
    () => fromServerDefault(user.data?.default_timeline_filter),
    [user.data?.default_timeline_filter]
  );
  const filter = useTimelineFilterStore((s) => s.filter);
  const setFilter = useTimelineFilterStore((s) => s.setFilter);
  const adoptDefault = useTimelineFilterStore((s) => s.adoptDefault);
  useEffect(() => {
    if (user.data) adoptDefault(savedDefault);
  }, [user.data, savedDefault, adoptDefault]);
  const [filterOpen, setFilterOpen] = useState(false);
  const filtered = isTimelineFilterActive(filter);
  const { items, loadMore, loadAtLeast } = useMirrorTimeline(filter);
  const buckets = useReactiveQuery((d) => timelineBuckets(d, filter), [filter], [
    "remote_photo",
    "local_asset",
    "local_album",
    "local_album_asset",
  ]);

  // Scrubber: the day at the top of the screen, a pending jump, and whether
  // the list moved recently (the handle fades out when the timeline is still).
  const [topDay, setTopDay] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [scrolling, setScrolling] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScrollActivity = useCallback(() => {
    setScrolling(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setScrolling(false), 1500);
  }, []);
  useEffect(() => () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);
  const scrubTo = useCallback(
    (day: string) => {
      // Load everything up to that day first; the list jumps once it is there.
      loadAtLeast(photosBefore(scrubberIndex(buckets), day) + 60);
      setScrollTarget(day);
    },
    [buckets, loadAtLeast]
  );
  const clearScrollTarget = useCallback(() => setScrollTarget(null), []);
  const selection = useGridSelection();
  const [refreshing, setRefreshing] = useState(false);
  const topInset = useTopBarInset();

  const onRefresh = useCallback(async () => {
    if (userId == null) return;
    setRefreshing(true);
    try {
      await runSync(db, { userId, reason: "refresh" });
    } finally {
      setRefreshing(false);
    }
  }, [db, userId]);

  const openPhoto = useCallback(
    (item: GridItem) => {
      if (selection.active) {
        selection.toggle(item);
        return;
      }
      // Never a dead tap: a camera-roll asset has no image hash until it is
      // hashed, and the old `if (item.imageHash)` guard silently swallowed the
      // press so the viewer looked unimplemented. The viewer resolves a remote
      // id, an image hash, or a local asset id — and the tile it already has
      // rides along so the viewer can paint before it queries anything.
      router.push(photoRoute(item));
    },
    [router, selection]
  );

  return (
    <View testID="timeline-screen" style={{ flex: 1, backgroundColor: theme.background }}>
      {items.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 32, paddingTop: topInset }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />}
        >
          <Text testID="timeline-empty" style={{ color: theme.muted, textAlign: "center" }}>
            {filtered ? t("timelineFilter.empty") : t("timeline.empty")}
          </Text>
          {filtered ? (
            <Pressable testID="timeline-filter-clear" onPress={() => setFilterOpen(true)} style={{ marginTop: 12 }}>
              <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("timelineFilter.title")}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <TimelineList
            items={items}
            serverAddress={base}
            accessToken={token}
            onPressItem={openPhoto}
            onLongPressItem={selection.enter}
            onToggleDay={(dayItems) => selection.toggleGroup(dayItems)}
            selectionActive={selection.active}
            isSelected={selection.isSelected}
            onEndReached={loadMore}
            topInset={topInset}
            scrollTarget={scrollTarget}
            onScrolledToTarget={clearScrollTarget}
            onTopDayChange={setTopDay}
            onScrollActivity={onScrollActivity}
            ListHeaderComponent={selection.active ? undefined : <MemoriesCard />}
          />
        </View>
      )}
      {items.length > 0 ? (
        <TimelineScrubber
          buckets={buckets}
          currentDay={topDay}
          visible={scrolling}
          topInset={topInset}
          onScrubEnd={scrubTo}
        />
      ) : null}
      {selection.active ? null : (
        <FloatingTopBar>
          <TopBarButton
            testID="timeline-filter-button"
            icon="filter"
            label={t("timelineFilter.open")}
            active={filtered}
            onPress={() => setFilterOpen(true)}
          />
        </FloatingTopBar>
      )}
      <TimelineFilterSheet
        visible={filterOpen}
        filter={filter}
        savedDefault={savedDefault}
        onChange={setFilter}
        onClose={() => setFilterOpen(false)}
      />
      {selection.overlay}
    </View>
  );
}
