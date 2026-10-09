import { useCallback, useState } from "react";
import { z } from "zod";
import { FacesTab } from "../../../api_client/faces/types";

/** Each tab's saved scroll position; a tab without one is not scrolled when it opens. */
type TabPositions = Partial<Record<FacesTab, number>>;

// Default tab scroll positions
const DEFAULT_TAB_POSITIONS = {
  [FacesTab.enum.labeled]: 0,
  [FacesTab.enum.inferred]: 0,
  [FacesTab.enum.unknown]: 0,
};

// The stored value is only ever written below, but it is read back without trusting it:
// a tab whose position is not a number is left out, and anything but an object is no
// positions at all
const StoredPosition = z.number().optional().catch(undefined);
const StoredPositions = z
  .object({ labeled: StoredPosition, inferred: StoredPosition, unknown: StoredPosition })
  .catch({});

function loadPositions(saved: string | null): TabPositions {
  if (!saved) return { ...DEFAULT_TAB_POSITIONS };
  return StoredPositions.parse(JSON.parse(saved));
}

// Custom hook to manage tab scroll positions in localStorage
export function useTabScrollPositions() {
  const [tabPositions, setTabPositions] = useState<TabPositions>(() => {
    try {
      return loadPositions(localStorage.getItem("faceTabScrollPositions"));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Error loading tab positions from localStorage:", e);
      return { ...DEFAULT_TAB_POSITIONS };
    }
  });

  const updatePosition = useCallback((tab: FacesTab, position: number) => {
    setTabPositions(prev => {
      const newPositions = { ...prev, [tab]: position };
      try {
        localStorage.setItem("faceTabScrollPositions", JSON.stringify(newPositions));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Error saving tab positions to localStorage:", e);
      }
      return newPositions;
    });
  }, []);

  return { tabPositions, updatePosition };
}
