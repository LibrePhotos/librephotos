import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { mediaHeaders } from "@librephotos/api-client";
import { PhotoTile, type GridItem } from "./PhotoTile";

export type { GridItem } from "./PhotoTile";

const NUM_COLUMNS = 3;
const GAP = 2;

type Props = {
  items: GridItem[];
  serverAddress: string;
  accessToken: string | null;
  onPressItem?: (item: GridItem) => void;
  onLongPressItem?: (item: GridItem) => void;
  onEndReached?: () => void;
  ListEmptyComponent?: React.ComponentType | React.ReactElement | null;
  ListHeaderComponent?: React.ComponentType | React.ReactElement | null;
  /** Multi-select mode: renders selection marks + routes taps to toggle. */
  selectionActive?: boolean;
  isSelected?: (key: string) => boolean;
  testID?: string;
};

/** A plain 3-column grid of mirror photos (filters, albums, people covers). */
export function MirrorGrid({
  items,
  serverAddress,
  accessToken,
  onPressItem,
  onLongPressItem,
  onEndReached,
  ListEmptyComponent,
  ListHeaderComponent,
  selectionActive = false,
  isSelected,
  testID = "mirror-grid",
}: Props) {
  const { width } = useWindowDimensions();
  const size = useMemo(() => Math.floor((width - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS), [width]);
  const headers = useMemo(() => mediaHeaders(accessToken), [accessToken]);

  return (
    <FlashList
      testID={testID}
      data={items}
      numColumns={NUM_COLUMNS}
      keyExtractor={(item) => item.key}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.6}
      extraData={selectionActive}
      ListEmptyComponent={ListEmptyComponent}
      ListHeaderComponent={ListHeaderComponent}
      renderItem={({ item }) => (
        <PhotoTile
          item={item}
          size={size}
          serverAddress={serverAddress}
          headers={headers}
          onPress={onPressItem}
          onLongPress={onLongPressItem}
          selectionActive={selectionActive}
          selected={isSelected ? isSelected(item.key) : false}
        />
      )}
    />
  );
}
