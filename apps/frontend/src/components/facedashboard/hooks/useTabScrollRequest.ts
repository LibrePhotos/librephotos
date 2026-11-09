import { useCallback, useState } from "react";
import type { FacesTab } from "../facesTab";

type Request = Readonly<{ tab: FacesTab; top: number | null }>;

/**
 * The scroll position the grid is asked to take: the saved one of a tab when it opens. The grid
 * only scrolls when the asked position changes, so the request is dropped at the first scroll
 * that follows it, whatever position that reached: a list shorter than the saved position stops
 * short of it, and a request left standing would keep the next tab saved at the same position from
 * scrolling there.
 */
export function useTabScrollRequest(activeTab: FacesTab, tabPositions: Partial<Record<FacesTab, number>>) {
  const [request, setRequest] = useState<Request>({ tab: activeTab, top: null });
  if (request.tab !== activeTab) {
    // A tab without a saved position is not scrolled
    setRequest({ tab: activeTab, top: tabPositions[activeTab] ?? null });
  }
  const scrollTo = request.tab === activeTab ? request.top : (tabPositions[activeTab] ?? null);
  const onScrolled = useCallback(() => setRequest(prev => (prev.top === null ? prev : { ...prev, top: null })), []);
  return { scrollTo, onScrolled };
}
