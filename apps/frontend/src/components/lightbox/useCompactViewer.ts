import { useMediaQuery } from "@mantine/hooks";

/** Under 600px wide: the phone layout of the viewer (a one-line title, the main actions in a bottom bar). */
const COMPACT_VIEWER_QUERY = "(max-width: 599px)";

/**
 * Whether the viewer uses its phone layout, as Google Photos and Immich do on a phone: back,
 * favorite and ⋮ on top, Share, Info and Delete in a bar at the bottom. Read on the first render,
 * so a phone never shows the desktop toolbar for a frame.
 */
export function useCompactViewer(): boolean {
  return useMediaQuery(COMPACT_VIEWER_QUERY, undefined, { getInitialValueInEffect: false });
}
