import { useCallback, useMemo } from "react";
import { z } from "zod";
import { FacesTab } from "../../../api_client/faces/types";
import { STORAGE_KEYS, useStoredState } from "../../../util/storage";

const NOTHING_FOLDED: Record<FacesTab, number[]> = { labeled: [], inferred: [], unknown: [] };

// The stored value ends up in `new Set(...)`, so a tab that is not an id array has to be
// dropped here rather than throwing out of a render. Ids that are not numbers are left out.
const StoredIds = z
  .array(z.unknown())
  .transform(ids => ids.filter((id): id is number => typeof id === "number"))
  .catch(() => []);
const StoredCollapsed = z
  .object({ labeled: StoredIds, inferred: StoredIds, unknown: StoredIds })
  .catch(() => ({ labeled: [], inferred: [], unknown: [] }));

// Custom hook to manage which person groups are folded, per tab, in localStorage
export function useCollapsedPersons() {
  const [collapsedIds, updateCollapsed] = useStoredState(
    STORAGE_KEYS.facesCollapsedPersons,
    StoredCollapsed,
    NOTHING_FOLDED
  );

  // Sets are what the grid calculation wants, and their identity only changes on a toggle
  const collapsedPersons = useMemo(
    () => ({
      [FacesTab.enum.labeled]: new Set(collapsedIds[FacesTab.enum.labeled]),
      [FacesTab.enum.inferred]: new Set(collapsedIds[FacesTab.enum.inferred]),
      [FacesTab.enum.unknown]: new Set(collapsedIds[FacesTab.enum.unknown]),
    }),
    [collapsedIds]
  );

  const toggleCollapsed = useCallback(
    (tab: FacesTab, personId: number) => {
      updateCollapsed(prev => ({
        ...prev,
        [tab]: prev[tab].includes(personId) ? prev[tab].filter(id => id !== personId) : [...prev[tab], personId],
      }));
    },
    [updateCollapsed]
  );

  const setCollapsedForTab = useCallback(
    (tab: FacesTab, personIds: number[]) => {
      updateCollapsed(prev => ({ ...prev, [tab]: personIds }));
    },
    [updateCollapsed]
  );

  return { collapsedPersons, toggleCollapsed, setCollapsedForTab };
}
