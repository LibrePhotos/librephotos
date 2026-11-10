import { useCallback, useRef, useState } from "react";
import { z } from "zod";
import { readStored, STORAGE_KEYS, writeStored } from "../../../util/storage";
import { FacesTab } from "../facesTab";

/** Each tab's saved scroll position; a tab without one is not scrolled when it opens. */
type TabPositions = Partial<Record<FacesTab, number>>;

// Default tab scroll positions
const DEFAULT_TAB_POSITIONS: Record<FacesTab, number> = {
  [FacesTab.enum.labeled]: 0,
  [FacesTab.enum.inferred]: 0,
  [FacesTab.enum.unknown]: 0,
  [FacesTab.enum.deleted]: 0,
};

// The stored value is only ever written below, but it is read back without trusting it:
// a tab whose position is not a number is left out, and anything but an object is no
// positions at all
const StoredPosition = z.number().optional().catch(undefined);
const StoredPositions = z
  .object({ labeled: StoredPosition, inferred: StoredPosition, unknown: StoredPosition, deleted: StoredPosition })
  .catch({});

// Custom hook to manage tab scroll positions in localStorage
export function useTabScrollPositions() {
  const [tabPositions, setTabPositions] = useState<TabPositions>(() =>
    readStored(STORAGE_KEYS.facesTabScrollPositions, StoredPositions, DEFAULT_TAB_POSITIONS)
  );
  const latest = useRef(tabPositions);

  // Written straight away, not from a state update: the dashboard saves the position it is left
  // at as it unmounts, and a state update made then never runs.
  const updatePosition = useCallback((tab: FacesTab, position: number) => {
    const next = { ...latest.current, [tab]: position };
    latest.current = next;
    writeStored(STORAGE_KEYS.facesTabScrollPositions, next);
    setTabPositions(next);
  }, []);

  return { tabPositions, updatePosition };
}
