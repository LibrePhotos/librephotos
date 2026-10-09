import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useCurrentUserSelfDetailsQuery, useSaveDefaultTimelineFilterMutation } from "../../api_client/user/hooks";
import type { User } from "../../api_client/user/types";
import {
  resolveTimelineFilter,
  savedTimelineFilter,
  timelineSearchFor,
  validateTimelineSearch,
  type TimelineFilter,
} from "./timelineFilter";

// The main timeline's filter state. The URL holds only the keys that differ
// from the user's saved default, so a bare "/" is the default; `ready` is
// false until that default has loaded, and the timeline waits for it rather
// than fetching (and showing) an unfiltered library first.
export function useTimelineFilter() {
  const navigate = useNavigate();
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const { data } = useCurrentUserSelfDetailsQuery();
  const user = data as User | undefined;
  const saveDefault = useSaveDefaultTimelineFilterMutation();
  const savedRaw = user?.default_timeline_filter;

  const saved = useMemo(() => savedTimelineFilter(savedRaw), [savedRaw]);
  // The router and the query cache keep both inputs' identity until they
  // change, so `current` is stable across unrelated renders.
  const current = useMemo(
    () => resolveTimelineFilter(savedRaw, validateTimelineSearch(rawSearch)),
    [savedRaw, rawSearch]
  );

  const setFilter = useCallback(
    (filter: TimelineFilter) => {
      // "/" has no search params besides the filter's.
      // Replace, not push: Back leaves the timeline rather than stepping
      // through every switch the user flipped.
      navigate({ to: "/", search: timelineSearchFor(filter, savedRaw), replace: true });
    },
    [navigate, savedRaw]
  );

  const reset = useCallback(() => {
    navigate({ to: "/", search: {}, replace: true });
  }, [navigate]);

  const saveAsDefault = useCallback(() => {
    if (!user) return;
    saveDefault.mutate(
      { userId: user.id, filter: current },
      // The URL's overrides are now the default: drop them.
      { onSuccess: reset }
    );
  }, [user, saveDefault, current, reset]);

  return {
    current,
    saved,
    ready: !!user,
    // Whether the library has any photos at all, to tell an empty library
    // from a filter that hides everything.
    libraryEmpty: user?.photo_count === 0,
    setFilter,
    reset,
    saveAsDefault,
    saving: saveDefault.isPending,
  };
}
