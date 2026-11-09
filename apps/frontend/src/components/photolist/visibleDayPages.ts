import type { PigPhoto } from "@librephotos/api-client";
import { useCallback, useState } from "react";
import { DATE_ALBUM_PAGE_SIZE } from "../../api_client/albums/hooks/useFetchDateAlbumsQuery";
import type { PigVisibleGroup } from "./PhotoListView";

/** A page of a day in a paginated date list (`day`: the day's id). */
export type DayPage = { day: number; page: number };

/**
 * Every day page that a placeholder on screen stands for, top first. All of them load at once, so a
 * screen of small days fills in one round trip instead of one day after another.
 */
export function dayPagesOnScreen(visibleGroups: PigVisibleGroup<PigPhoto>[]): DayPage[] {
  const pages: DayPage[] = [];
  visibleGroups.forEach(group => {
    group.items.forEach(item => {
      if (!item.isTemp) return;
      const page = Math.floor(parseInt(item.id, 10) / DATE_ALBUM_PAGE_SIZE) + 1;
      if (!pages.some(known => known.day === group.id && known.page === page)) pages.push({ day: group.id, page });
    });
  });
  return pages;
}

const samePages = (a: DayPage[], b: DayPage[]) =>
  a.length === b.length && a.every((page, i) => page.day === b[i]?.day && page.page === b[i]?.page);

type Shown = { scope: string; pages: DayPage[] };

/**
 * The day pages a photo list last reported on screen, and the `updateGroups` that reports them.
 * `scope` names the list (its filters): pages reported under another scope are not returned, so a
 * day of the old list is not asked for again under new filters.
 */
export function useDayPagesOnScreen(scope: string) {
  const [shown, setShown] = useState<Shown>({ scope, pages: [] });
  const updateGroups = useCallback(
    (visibleGroups: PigVisibleGroup<PigPhoto>[]) => {
      const pages = dayPagesOnScreen(visibleGroups);
      setShown(previous =>
        previous.scope === scope && samePages(previous.pages, pages) ? previous : { scope, pages }
      );
    },
    [scope]
  );
  return { pages: shown.scope === scope ? shown.pages : [], updateGroups };
}
