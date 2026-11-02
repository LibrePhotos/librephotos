import type { Href } from "expo-router";
import type { IconName } from "@/components/Icon";
import type { PhotoFilter } from "@/db/queries/filters";

/**
 * The photo views that used to sit behind the web's Photos dropdown and the
 * old Photos sub-routes nobody could reach. On a phone they live in the
 * Collections tab, as quick tiles and a short list (like Google Photos'
 * "Favorites / Archive / Trash" and Apple's "Utilities").
 */
export type LibraryView = {
  filter: PhotoFilter;
  icon: IconName;
  /** i18n key of the view's name. */
  titleKey: string;
};

export const LIBRARY_VIEWS: readonly LibraryView[] = [
  { filter: "favorites", icon: "heart", titleKey: "library.favorites" },
  { filter: "videos", icon: "video", titleKey: "library.videos" },
  { filter: "recent", icon: "recent", titleKey: "library.recent" },
  { filter: "deleted", icon: "trash", titleKey: "library.trash" },
  { filter: "archived", icon: "archive", titleKey: "library.archive" },
  { filter: "screenshots", icon: "screenshot", titleKey: "library.screenshots" },
  { filter: "documents", icon: "document", titleKey: "library.documents" },
  { filter: "hidden", icon: "hide", titleKey: "library.hidden" },
  { filter: "notimestamp", icon: "calendar", titleKey: "library.noTimestamp" },
];

/** The four shown as big tiles at the top of Collections; the rest are rows. */
export const QUICK_VIEWS: readonly PhotoFilter[] = ["favorites", "videos", "recent", "deleted"];

export function libraryView(filter: string | string[] | undefined): LibraryView | null {
  if (typeof filter !== "string") return null;
  return LIBRARY_VIEWS.find((v) => v.filter === filter) ?? null;
}

export function libraryHref(filter: PhotoFilter): Href {
  return { pathname: "/albums/library/[filter]", params: { filter } };
}
