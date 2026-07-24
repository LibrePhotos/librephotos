import { useMemo } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { mediaHeaders } from "@librephotos/api-client";
import { PhotoTile, type GridItem } from "./PhotoTile";
import { useTheme } from "@/theme";

export type TimelineItem = GridItem & { day: string };

const NUM_COLUMNS = 3;
const GAP = 2;

type ListRow =
  | { kind: "header"; day: string; key: string }
  | { kind: "row"; items: TimelineItem[]; key: string };

/** Group day-ordered items into header rows + rows of up to 3 photos. */
function toRows(items: TimelineItem[]): ListRow[] {
  const rows: ListRow[] = [];
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
      rows.push({ kind: "header", day: item.day, key: `h-${item.day}` });
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
  onEndReached,
  ListHeaderComponent,
  ListEmptyComponent,
  testID = "timeline-list",
}: {
  items: TimelineItem[];
  serverAddress: string;
  accessToken: string | null;
  onPressItem?: (item: GridItem) => void;
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
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={ListEmptyComponent}
      renderItem={({ item: row }) =>
        row.kind === "header" ? (
          <Text
            testID={`section-${row.day}`}
            style={{ color: theme.text, fontWeight: "600", fontSize: 15, paddingHorizontal: 12, paddingTop: 16, paddingBottom: 6 }}
          >
            {row.day}
          </Text>
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
              />
            ))}
          </View>
        )
      }
    />
  );
}
