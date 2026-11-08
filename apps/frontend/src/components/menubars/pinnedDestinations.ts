import type { Icon } from "@tabler/icons-react";
import {
  IconArchive,
  IconCalendarEvent,
  IconFaceId,
  IconMapPin,
  IconMovie,
  IconSparkles,
  IconStar,
  IconTag,
  IconUserCircle,
} from "@tabler/icons-react";
import { z } from "zod";
import { STORAGE_KEYS, useStoredState } from "../../util/storage";
import { isNavItemActive } from "./navigation";

/**
 * Pages a user can pin to the sidebar under its four sections (Photos, Albums, Sharing, Trash).
 * The sidebar stays short by default; pinning brings a page someone opens often one click away.
 */
export const PINNABLE_DESTINATIONS = [
  { id: "favorites", link: "/favorites", icon: IconStar, label: "sidemenu.favorites" },
  { id: "memories", link: "/memories", icon: IconSparkles, label: "sidemenu.memories" },
  { id: "people", link: "/album/persons", icon: IconUserCircle, label: "sidemenu.people" },
  // The face dashboard, for those who label faces often; its row counts the faces waiting
  { id: "faces", link: "/faces", icon: IconFaceId, label: "sidemenu.facerecognition" },
  { id: "places", link: "/album/places", icon: IconMapPin, label: "sidemenu.places" },
  { id: "events", link: "/album/events", icon: IconCalendarEvent, label: "events" },
  { id: "things", link: "/album/things", icon: IconTag, label: "sidemenu.things" },
  { id: "videos", link: "/videos", icon: IconMovie, label: "sidemenu.videos" },
  { id: "archive", link: "/archived", icon: IconArchive, label: "sidemenu.archive" },
] as const satisfies ReadonlyArray<{ id: string; link: string; icon: Icon; label: string }>;

export type PinnableDestination = (typeof PINNABLE_DESTINATIONS)[number];

const DestinationId = z.enum(PINNABLE_DESTINATIONS.map(destination => destination.id));
type DestinationId = z.infer<typeof DestinationId>;

// Unknown ids (a destination removed in a later version) are dropped rather than failing the list.
const PinnedIds = z
  .array(z.string())
  .transform(ids => ids.filter((id): id is DestinationId => DestinationId.safeParse(id).success));

/** The pinned pages, in the order of PINNABLE_DESTINATIONS, and a toggle; kept in this browser. */
export function usePinnedDestinations() {
  const [pinnedIds, setPinnedIds] = useStoredState<DestinationId[]>(STORAGE_KEYS.sidebarPinned, PinnedIds, []);
  const pinned = PINNABLE_DESTINATIONS.filter(destination => pinnedIds.includes(destination.id));
  const toggle = (id: DestinationId) =>
    setPinnedIds(previous => (previous.includes(id) ? previous.filter(other => other !== id) : [...previous, id]));
  return { pinned, isPinned: (id: DestinationId) => pinnedIds.includes(id), toggle };
}

/** The pinned page the path is on, if any: it is the one the sidebar marks, not its section. */
export function activePinnedLink(pinned: readonly PinnableDestination[], pathname: string): string | null {
  return pinned.find(destination => isNavItemActive(destination, pathname))?.link ?? null;
}
