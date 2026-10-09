import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import { FacesTab } from "../../../api_client/faces/types";

const STORAGE_KEY = "faceCollapsedPersons";

function save(collapsed: Record<FacesTab, number[]>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Error saving collapsed persons to localStorage:", e);
  }
  return collapsed;
}

// The stored value ends up in `new Set(...)`, so a tab that is not an id array has to be
// dropped here rather than throwing out of a render. Ids that are not numbers are left out.
const StoredIds = z
  .array(z.unknown())
  .transform(ids => ids.filter((id): id is number => typeof id === "number"))
  .catch(() => []);
const StoredCollapsed = z
  .object({ labeled: StoredIds, inferred: StoredIds, unknown: StoredIds })
  .catch(() => ({ labeled: [], inferred: [], unknown: [] }));

function load(): Record<FacesTab, number[]> {
  let parsed: unknown = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    parsed = saved ? JSON.parse(saved) : null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Error loading collapsed persons from localStorage:", e);
  }
  return StoredCollapsed.parse(parsed);
}

// Custom hook to manage which person groups are folded, per tab, in localStorage
export function useCollapsedPersons() {
  const [collapsedIds, setCollapsedIds] = useState<Record<FacesTab, number[]>>(load);

  // Sets are what the grid calculation wants, and their identity only changes on a toggle
  const collapsedPersons = useMemo(
    () => ({
      [FacesTab.enum.labeled]: new Set(collapsedIds[FacesTab.enum.labeled]),
      [FacesTab.enum.inferred]: new Set(collapsedIds[FacesTab.enum.inferred]),
      [FacesTab.enum.unknown]: new Set(collapsedIds[FacesTab.enum.unknown]),
    }),
    [collapsedIds]
  );

  const toggleCollapsed = useCallback((tab: FacesTab, personId: number) => {
    setCollapsedIds(prev => {
      const ids = prev[tab].includes(personId) ? prev[tab].filter(id => id !== personId) : [...prev[tab], personId];
      return save({ ...prev, [tab]: ids });
    });
  }, []);

  const setCollapsedForTab = useCallback((tab: FacesTab, personIds: number[]) => {
    setCollapsedIds(prev => save({ ...prev, [tab]: personIds }));
  }, []);

  return { collapsedPersons, toggleCollapsed, setCollapsedForTab };
}
