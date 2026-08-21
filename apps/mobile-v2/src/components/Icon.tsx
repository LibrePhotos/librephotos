import { Ionicons } from "@expo/vector-icons";

/**
 * The app's icon vocabulary, in one place.
 *
 * Icons are named *semantically* here (`myAlbums`, `viewAll`, …) and mapped to
 * a concrete glyph set exactly once, in `GLYPHS` below. Swapping icon sets — or
 * dropping `@expo/vector-icons` — is therefore a one-file change, and no screen
 * ever hard-codes a vendor glyph name.
 *
 * Never render icons as bare Unicode characters (`▦ ▧ ⌕ ↑`). That approach
 * already shipped once and rendered as blank space on iOS, whose system font
 * has no glyph for them. `@expo/vector-icons` is bundled inside Expo Go, so it
 * costs no native code and no dev build.
 */
export type IconName =
  | "explore"
  | "myAlbums"
  | "people"
  | "things"
  | "places"
  | "tags"
  | "events"
  | "folders"
  | "faces"
  | "viewAll"
  | "search"
  | "clear"
  | "photo"
  | "offline"
  | "recent"
  // viewer / lightbox
  | "back"
  | "info"
  | "star"
  | "starOutline"
  | "hide"
  | "unhide"
  | "trash"
  | "restore"
  | "edit"
  | "camera"
  | "calendar"
  | "location"
  | "album"
  | "similar"
  | "public"
  | "copy"
  | "expand"
  | "collapse"
  | "play"
  | "file"
  | "sparkle";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const GLYPHS: Record<IconName, IoniconName> = {
  explore: "albums-outline",
  myAlbums: "bookmark-outline",
  people: "people-outline",
  things: "pricetags-outline",
  places: "map-outline",
  tags: "pricetag-outline",
  events: "sparkles-outline",
  folders: "folder-outline",
  faces: "happy-outline",
  viewAll: "chevron-forward",
  search: "search-outline",
  clear: "close-circle",
  photo: "image-outline",
  offline: "cloud-offline-outline",
  recent: "time-outline",
  back: "chevron-back",
  info: "information-circle-outline",
  star: "star",
  starOutline: "star-outline",
  hide: "eye-off-outline",
  unhide: "eye-outline",
  trash: "trash-outline",
  restore: "arrow-undo-outline",
  edit: "pencil",
  camera: "camera-outline",
  calendar: "calendar-outline",
  location: "location-outline",
  album: "albums-outline",
  similar: "copy-outline",
  public: "globe-outline",
  copy: "clipboard-outline",
  expand: "chevron-down",
  collapse: "chevron-up",
  play: "play",
  file: "document-outline",
  sparkle: "sparkles-outline",
};

export function Icon({
  name,
  size = 20,
  color,
  testID,
}: {
  name: IconName;
  size?: number;
  color: string;
  testID?: string;
}) {
  return <Ionicons name={GLYPHS[name]} size={size} color={color} testID={testID} />;
}
