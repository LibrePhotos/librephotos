import type { PigPhoto } from "@librephotos/api-client";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ScrollerData } from "../scrollscrubber/scrollScrubberTypes";
import type { PigHandle } from "./PhotoListView";

// One scrubber marker per group (date views) or per tile (flat views).
const getScrollPositions = (pig: PigHandle<PigPhoto>): ScrollerData[] => {
  const scrollPositions: ScrollerData[] = [];
  pig.imageData.forEach(entry => {
    // A flat list's tiles have no group position, so (as before) they give
    // the scrubber NaN, which places no usable marker.
    const group = "items" in entry ? entry : undefined;
    scrollPositions.push({
      label: entry.date ?? "",
      targetY: group?.groupTranslateY ?? Number.NaN,
      year: group?.year,
      month: group?.month,
      count: group?.items.length,
    });
  });
  return scrollPositions;
};

// The scroll scrubber's markers and the grid height it scales to, read back from Pig.
export const usePhotoListScrollScrubber = (isLoading: boolean, pigRef: RefObject<PigHandle<PigPhoto> | null>) => {
  const [dataForScrollIndicator, setDataForScrollIndicator] = useState<ScrollerData[]>([]);
  const gridHeight = useRef(200);

  useEffect(() => {
    if (!isLoading && pigRef.current) {
      setDataForScrollIndicator(getScrollPositions(pigRef.current));
      gridHeight.current = pigRef.current.totalHeight;
    }
    // Pig exposes its layout through the imperative handle; re-read it whenever
    // the height it reports on this render differs. getScrollPositions only
    // reads that ref.
  }, [isLoading, pigRef, pigRef.current?.totalHeight]);

  return { dataForScrollIndicator, gridHeight };
};
