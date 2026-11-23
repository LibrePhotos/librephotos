/**
 * Whether the panel section around a component is open. A collapsed section stays mounted (its
 * Collapse animates), so a panel that works per frame (a histogram, thumbnails) asks this and rests
 * while its section is closed. Outside any section it is open.
 */
import { createContext, useContext } from "react";

export const SectionOpenContext = createContext(true);

export function useSectionOpen(): boolean {
  return useContext(SectionOpenContext);
}
