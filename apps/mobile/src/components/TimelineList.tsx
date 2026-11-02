import { useEffect, useMemo, useRef } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { FlashList, type FlashListRef, type ViewToken } from "@shopify/flash-list";
import { useTranslation } from "react-i18next";
import { mediaHeaders } from "@librephotos/api-client";
import { formatDayHeading } from "@/lib/format";
import { noteScroll } from "@/sync/activity";
import { PhotoTile, type GridItem } from "./PhotoTile";
import { useTheme } from "@/theme";

export type TimelineItem = GridItem & { day: string };

const NUM_COLUMNS = 3;
const GAP = 2;

type ListRow =
  | { kind: "header"; day: string; key: string; items: TimelineItem[] }
  | { kind: "row"; items: TimelineItem[]; key: string };

/** Group day-ordered items into header rows + rows of up to 3 photos. */
function toRows(items: TimelineItem[]): ListRow[] {
  const rows: ListRow[] = [];
  const dayItems = new Map<string, TimelineItem[]>();
  for (const item of items) {
    const list = dayItems.get(item.day) ?? [];
    list.push(item);
    dayItems.set(item.day, list);
  }
  let currentDay: string | null = null;
  let bucket: TimelineItem[] = [];
  const flush = () => {
    for (let i = 0; i < bucket.length; i += NUM_COLUMNS) {
      const chunk = bucket.slice(i, i + NUM_COLUMNS);
      rows.push({ kind: "row", items: chunk, key: `row-${chunk[0].key}` });
    }
    bucket = [];
  };
  for (const item of items) {
    if (item.day !== currentDay) {
      flush();
      currentDay = item.day;
      rows.push({ kind: "header", day: item.day, key: `h-${item.day}`, items: dayItems.get(item.day) ?? [] });
    }
    bucket.push(item);
  }
  flush();
  return rows;
}

/**
 * The photos timeline: day section headers over a 3-column grid, from the
 * SQLite mirror. A single vertical FlashList renders header rows and photo rows,
 * so day headers span full width without grid-spanning hacks and 100k-item
 * timelines stay smooth.
 */
export function TimelineList({
  items,
  serverAddress,
  accessToken,
  onPressItem,
  onLongPressItem,
  onToggleDay,
  selectionActive = false,
  isSelected,
  onEndReached,
  ListHeaderComponent,
  ListEmptyComponent,
  topInset = 0,
  scrollTarget = null,
  onScrolledToTarget,
  onTopDayChange,
  onScrollActivity,
  testID = "timeline-list",
}: {
  items: TimelineItem[];
  serverAddress: string;
  accessToken: string | null;
  onPressItem?: (item: GridItem) => void;
  onLongPressItem?: (item: GridItem) => void;
  /** Select/deselect a whole day section (from its header). */
  onToggleDay?: (items: GridItem[]) => void;
  selectionActive?: boolean;
  isSelected?: (key: string) => boolean;
  onEndReached?: () => void;
  ListHeaderComponent?: React.ComponentType | React.ReactElement | null;
  ListEmptyComponent?: React.ComponentType | React.ReactElement | null;
  /** Room left above the first row for a floating top bar. */
  topInset?: number;
  /** A day to jump to (the scrubber); the list scrolls there once it is loaded. */
  scrollTarget?: string | null;
  onScrolledToTarget?: () => void;
  /** The day of the first row on screen, as the user scrolls. */
  onTopDayChange?: (day: string) => void;
  onScrollActivity?: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const size = useMemo(() => Math.floor((width - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS), [width]);
  const headers = useMemo(() => mediaHeaders(accessToken), [accessToken]);
  const rows = useMemo(() => toRows(items), [items]);
  const listRef = useRef<FlashListRef<ListRow>>(null);

  useEffect(() => {
    if (!scrollTarget) return;
    const index = rows.findIndex((r) => r.kind === "header" && r.day === scrollTarget);
    if (index < 0) return; // not loaded yet; the caller grows the window
    // Land the day's header just below the floating top bar, not under it.
    // FlashList 2 adds viewOffset to the scroll position (FlatList subtracts
    // it), so moving the header down the screen takes a negative offset.
    listRef.current?.scrollToIndex({ index, animated: false, viewOffset: -topInset });
    onScrolledToTarget?.();
  }, [scrollTarget, rows, onScrolledToTarget, topInset]);

  const onViewableItemsChanged = useMemo(
    () =>
      onTopDayChange
        ? ({ viewableItems }: { viewableItems: ViewToken<ListRow>[] }) => {
            const first = viewableItems.find((v) => v.item != null);
            if (!first?.item) return;
            const row = first.item;
            onTopDayChange(row.kind === "header" ? row.day : row.items[0].day);
          }
        : undefined,
    [onTopDayChange]
  );
  // Section headers used to print the raw `bucket_day` key ("2026-07-24").
  // The testID keeps the key so tests and scroll targets stay stable.
  const dayLabels = useMemo(
    () => ({ today: t("date.today"), yesterday: t("date.yesterday") }),
    [t]
  );

  return (
    <FlashList
      ref={listRef}
      testID={testID}
      onViewableItemsChanged={onViewableItemsChanged}
      data={rows}
      keyExtractor={(r) => r.key}
      getItemType={(r) => r.kind}
      // The scan's back-off signal. `onScroll` fires throughout a drag *and* its
      // momentum, so it keeps the interaction window alive for the whole gesture
      // — unlike a touch-start sniffer, which a native ScrollView never reports
      // for the frames that actually matter.
      onScroll={() => {
        noteScroll();
        onScrollActivity?.();
      }}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      extraData={selectionActive}
      contentContainerStyle={topInset > 0 ? { paddingTop: topInset } : undefined}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={ListEmptyComponent}
      renderItem={({ item: row }) =>
        row.kind === "header" ? (
          <Pressable
            testID={`section-${row.day}`}
            onPress={selectionActive && onToggleDay ? () => onToggleDay(row.items) : undefined}
            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6 }}
          >
            <Text style={{ color: theme.text, fontWeight: "600", fontSize: 15 }}>
              {formatDayHeading(row.day, { locale: i18n.language, labels: dayLabels })}
            </Text>
            {selectionActive ? (
              <Text testID={`section-select-${row.day}`} style={{ color: theme.brand, fontSize: 13, fontWeight: "600" }}>
                ⊟
              </Text>
            ) : null}
          </Pressable>
        ) : (
          <View style={{ flexDirection: "row", gap: GAP, paddingHorizontal: 0 }}>
            {row.items.map((item) => (
              <PhotoTile
                key={item.key}
                item={item}
                size={size}
                serverAddress={serverAddress}
                headers={headers}
                onPress={onPressItem}
                onLongPress={onLongPressItem}
                selectionActive={selectionActive}
                selected={isSelected ? isSelected(item.key) : false}
              />
            ))}
          </View>
        )
      }
    />
  );
}
