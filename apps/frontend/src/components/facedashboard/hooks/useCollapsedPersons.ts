import { useCallback, useMemo, useState } from "react";
import { FacesTab } from "../../../api_client/faces/types";

const STORAGE_KEY = "faceCollapsedPersons";

// Default collapsed person ids per tab
const DEFAULT_COLLAPSED_PERSONS: Record<FacesTab, number[]> = {
  [FacesTab.enum.labeled]: [],
  [FacesTab.enum.inferred]: [],
  [FacesTab.enum.unknown]: [],
};

function save(collapsed: Record<FacesTab, number[]>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Error saving collapsed persons to localStorage:", e);
  }
  return collapsed;
}

// Custom hook to manage which person groups are folded, per tab, in localStorage
export function useCollapsedPersons() {
  const [collapsedIds, setCollapsedIds] = useState<Record<FacesTab, number[]>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...DEFAULT_COLLAPSED_PERSONS, ...JSON.parse(saved) } : { ...DEFAULT_COLLAPSED_PERSONS };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Error loading collapsed persons from localStorage:", e);
      return { ...DEFAULT_COLLAPSED_PERSONS };
    }
  });

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
