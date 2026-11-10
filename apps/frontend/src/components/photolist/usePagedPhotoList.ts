import type { PigPhoto } from "@librephotos/api-client";
import { useCallback, useMemo, useState } from "react";
import type { PhotoPages } from "../../api_client/photos/hooks/usePhotoPages";
import { layoutPages, pagesOnScreen } from "./pagedPhotoList";

const FIRST_PAGE: readonly number[] = [1];

type RequestedPages = { pages: readonly number[]; request: (wanted: readonly number[]) => void };

/**
 * The pages a paged photo list has asked for so far, page 1 first. A page stays asked for once
 * it was on screen, so its photos stay in the list after it scrolls away.
 */
export function useRequestedPages(): RequestedPages {
  const [pages, setPages] = useState(FIRST_PAGE);
  const request = useCallback((wanted: readonly number[]) => {
    setPages(previous => {
      const added = wanted.filter(page => !previous.includes(page));
      return added.length > 0 ? [...previous, ...added] : previous;
    });
  }, []);
  return { pages, request };
}

/**
 * A flat, paged photo list (No timestamp, No location, Not in an album), read in render from the
 * answers of every page asked for: the newest answer's count lays out a placeholder per photo, and
 * each page fills its slots (`layoutPages`). PhotoListView's `updateItems` (`loadVisiblePage`) asks
 * for every page with a placeholder on screen, and again for one on screen that failed or was
 * answered for another count.
 */
export function usePagedPhotoList({ pages, request }: RequestedPages, photoPages: PhotoPages) {
  const { answers, failed, fetching, refetch } = photoPages;
  const layout = useMemo(() => layoutPages(pages, answers), [pages, answers]);

  const loadVisiblePage = useCallback(
    (visibleItems: PigPhoto[]) => {
      const onScreen = pagesOnScreen(visibleItems);
      request(onScreen);
      onScreen.forEach(page => {
        const i = pages.indexOf(page);
        if (i < 0 || fetching[i]) return;
        if (layout.stale.has(page) || (failed[i] && !answers[i])) void refetch[i]?.();
      });
    },
    [request, pages, layout, answers, failed, fetching, refetch]
  );

  // Page 1, for the list's loading and failed states.
  const firstPage = {
    data: answers[0]?.data,
    isError: failed[0] === true,
    isFetching: fetching[0] === true,
    refetch: refetch[0] ?? (() => Promise.resolve()),
  };
  return { photosFlat: layout.photos, loadVisiblePage, firstPage };
}
