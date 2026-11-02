import { create } from "zustand";
import type { TimelineFilterDefault } from "@librephotos/api-client";
import { NO_TIMELINE_FILTER, type TimelineFilter } from "@/db/queries/timeline";

/** The saved default, as the web stores it on the user (`default_timeline_filter`). */
export function fromServerDefault(saved: TimelineFilterDefault | undefined): TimelineFilter {
  return {
    media: saved?.media ?? "all",
    favorites: saved?.favorites ?? false,
    hideScreenshots: saved?.hide_screenshots ?? false,
    hideDocuments: saved?.hide_documents ?? false,
  };
}

/** Only the keys that differ from "show everything", like the web saves it. */
export function toServerDefault(filter: TimelineFilter): TimelineFilterDefault {
  const saved: TimelineFilterDefault = {};
  if (filter.media !== "all") saved.media = filter.media;
  if (filter.favorites) saved.favorites = true;
  if (filter.hideScreenshots) saved.hide_screenshots = true;
  if (filter.hideDocuments) saved.hide_documents = true;
  return saved;
}

export function sameFilter(a: TimelineFilter, b: TimelineFilter): boolean {
  return (
    a.media === b.media &&
    a.favorites === b.favorites &&
    a.hideScreenshots === b.hideScreenshots &&
    a.hideDocuments === b.hideDocuments
  );
}

type TimelineFilterState = {
  filter: TimelineFilter;
  /** True once the user changed the filter by hand this session. */
  touched: boolean;
  setFilter: (filter: TimelineFilter) => void;
  /** Adopt the saved default, unless the user already picked something. */
  adoptDefault: (filter: TimelineFilter) => void;
};

/**
 * The timeline filter in use. It starts from the default the user saved (on
 * the web or here) and lives for the session; changing it does not save it.
 */
export const useTimelineFilterStore = create<TimelineFilterState>((set, get) => ({
  filter: NO_TIMELINE_FILTER,
  touched: false,
  setFilter: (filter) => set({ filter, touched: true }),
  adoptDefault: (filter) => {
    if (!get().touched) set({ filter });
  },
}));
