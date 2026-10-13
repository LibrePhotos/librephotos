import type { PigPhoto } from "@librephotos/api-client";
import { useEffect, useState } from "react";
import { addTempElementsToFlatList } from "../../util/util";

// The server's page size for the paged photo lists (DefaultPagination).
const PAGE_SIZE = 100;

type PhotoPage = { count: number; results: PigPhoto[] };

type PageQuery = {
  data: PhotoPage | undefined;
  isPlaceholderData: boolean;
};

/**
 * A flat, paged photo list (No timestamp, Not in an album): the first page's count lays out a
 * placeholder per photo, and each page of 100 is spliced into its slots once the user scrolls to
 * it. `page` and `setPage` belong to the route, which hands `page` to its query hook.
 *
 * While the next page loads, the query keeps showing the previous page's photos as placeholder
 * data. Splicing those in at the new page's offset would duplicate them over its placeholders.
 */
export function usePagedPhotoList(
  { data, isPlaceholderData }: PageQuery,
  page: number,
  setPage: (page: number) => void
) {
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);

  useEffect(() => {
    if (!data || isPlaceholderData) {
      return;
    }
    setPhotosFlat(previous => {
      const photos = page === 1 ? addTempElementsToFlatList(data.count) : [...previous];
      photos.splice((page - 1) * PAGE_SIZE, PAGE_SIZE, ...data.results);
      return photos;
    });
  }, [data, isPlaceholderData, page]);

  // PhotoListView's `updateItems`: asks for the page of the first placeholder in view.
  const loadVisiblePage = (visibleItems: PigPhoto[]) => {
    const firstTempObject = visibleItems.find(i => i.isTemp);
    if (!firstTempObject) {
      return;
    }
    // Placeholder ids are "temp-<index>"
    const tempIndex = parseInt(firstTempObject.id.replace("temp-", ""), 10);
    const pageNumber = Math.ceil((tempIndex + 1) / PAGE_SIZE);
    if (pageNumber > 1) {
      setPage(pageNumber);
    }
  };

  return { photosFlat, loadVisiblePage };
}
