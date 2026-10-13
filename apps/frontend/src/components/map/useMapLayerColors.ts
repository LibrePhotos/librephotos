import { useComputedColorScheme } from "@mantine/core";
import { mapLayerColors, type MapLayerColors } from "../../theme/mapColors";

/** The colours for layers painted on a ThemedMap, which a dark map filters (theme/mapColors.ts). */
export function useMapLayerColors(): MapLayerColors {
  return mapLayerColors(useComputedColorScheme("light", { getInitialValueInEffect: false }));
}
