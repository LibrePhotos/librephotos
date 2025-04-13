import { useState, useCallback } from "react";
import { FacesTab } from "../../../api_client/faces/types";

// Default tab scroll positions
const DEFAULT_TAB_POSITIONS = {
  [FacesTab.enum.labeled]: 0,
  [FacesTab.enum.inferred]: 0,
  [FacesTab.enum.unknown]: 0,
};

// Custom hook to manage tab scroll positions in localStorage
export function useTabScrollPositions() {
  const [tabPositions, setTabPositions] = useState(() => {
    try {
      const saved = localStorage.getItem('faceTabScrollPositions');
      return saved ? JSON.parse(saved) : { ...DEFAULT_TAB_POSITIONS };
    } catch (e) {
      console.error('Error loading tab positions from localStorage:', e);
      return { ...DEFAULT_TAB_POSITIONS };
    }
  });

  const updatePosition = useCallback((tab: FacesTab, position: number) => {
    setTabPositions(prev => {
      const newPositions = { ...prev, [tab]: position };
      try {
        localStorage.setItem('faceTabScrollPositions', JSON.stringify(newPositions));
      } catch (e) {
        console.error('Error saving tab positions to localStorage:', e);
      }
      return newPositions;
    });
  }, []);

  return { tabPositions, updatePosition };
} 