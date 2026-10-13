import type { PigPhoto } from "@librephotos/api-client";
import { throttle } from "lodash-es";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { GroupedImageItem, PigVisibleGroup } from "./PhotoListView";

// Only the paginated date lists' groups carry the date album id that names the
// page still to load; the others have nothing to fetch.
const hasCursor = (group: GroupedImageItem<PigPhoto>): group is PigVisibleGroup<PigPhoto> =>
  typeof group.id === "number";

// Throttles the visible-groups and visible-items reports a photo list passes up to
// its caller (they load the pages the placeholders stand for).
export const usePhotoListThrottledUpdates = (
  updateGroups: ((visibleGroups: PigVisibleGroup<PigPhoto>[]) => void) | undefined,
  updateItems: ((visibleItems: PigPhoto[]) => void) | undefined
) => {
  // The throttled wrappers must keep one identity (a new throttle per render
  // would never throttle), but must call the caller's *latest* callback: parents
  // pass closures over their current state, and calling the first-render one
  // forever fetches with stale state.
  const updateGroupsRef = useRef(updateGroups);
  const updateItemsRef = useRef(updateItems);
  // Layout effect: Pig reports visible groups from its own (passive) effects,
  // which run before this component's passive effects on the same commit.
  useLayoutEffect(() => {
    updateGroupsRef.current = updateGroups;
    updateItemsRef.current = updateItems;
  }, [updateGroups, updateItems]);

  const throttledUpdateGroups = useMemo(
    () =>
      throttle(
        (visibleGroups: GroupedImageItem<PigPhoto>[]) => updateGroupsRef.current?.(visibleGroups.filter(hasCursor)),
        500
      ),
    []
  );
  const throttledUpdateItems = useMemo(
    () => throttle((visibleItems: PigPhoto[]) => updateItemsRef.current?.(visibleItems), 500),
    []
  );
  useEffect(
    () => () => {
      throttledUpdateGroups.cancel();
      throttledUpdateItems.cancel();
    },
    [throttledUpdateGroups, throttledUpdateItems]
  );

  return { throttledUpdateGroups, throttledUpdateItems };
};
