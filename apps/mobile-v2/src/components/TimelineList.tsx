import { useMemo } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { mediaHeaders } from "@librephotos/api-client";
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
  testID?: string;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const size = useMemo(() => Math.floor((width - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS), [width]);
  const headers = useMemo(() => mediaHeaders(accessToken), [accessToken]);
  const rows = useMemo(() => toRows(items), [items]);

  return (
    <FlashList
      testID={testID}
      data={rows}
      keyExtractor={(r) => r.key}
      getItemType={(r) => r.kind}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      extraData={selectionActive}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={ListEmptyComponent}
      renderItem={({ item: row }) =>
        row.kind === "header" ? (
          <Pressable
            testID={`section-${row.day}`}
            onPress={selectionActive && onToggleDay ? () => onToggleDay(row.items) : undefined}
            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6 }}
          >
            <Text style={{ color: theme.text, fontWeight: "600", fontSize: 15 }}>{row.day}</Text>
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
