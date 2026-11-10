import type { PigPhoto } from "@librephotos/api-client";
import { addTempElementsToFlatList } from "../../util/util";

/** The server's page size for the paged photo lists (DefaultPagination). */
const PAGE_SIZE = 100;

type PhotoPage = { count: number; results: PigPhoto[] };

/** A page's answer and when it arrived; undefined while the page has none. */
type PageAnswer = { data: PhotoPage; at: number } | undefined;

type PagedLayout = {
  photos: PigPhoto[];
  /** Pages answered for another count than the newest answer: their offsets may have moved. */
  stale: ReadonlySet<number>;
};

const newestAnswer = (answers: readonly PageAnswer[]): PageAnswer =>
  answers.reduce<PageAnswer>(
    (newest, answer) => (answer && (!newest || answer.at > newest.at) ? answer : newest),
    undefined
  );

/**
 * The flat list of a paged photo list (No timestamp, No location, Not in an album): a placeholder
 * for each of the newest answer's `count` photos, and every page answered for that same count in
 * its slots. `answers[i]` is the answer of `pages[i]`. A page answered for another count keeps its
 * placeholders until it is asked again, so a photo deleted meanwhile does not shift the photos of
 * the pages after it, or show twice.
 */
export function layoutPages(pages: readonly number[], answers: readonly PageAnswer[]): PagedLayout {
  const newest = newestAnswer(answers);
  if (!newest) return { photos: [], stale: new Set() };
  const { count } = newest.data;
  const photos = addTempElementsToFlatList(count);
  const stale = new Set<number>();
  pages.forEach((page, i) => {
    const answer = answers[i];
    if (!answer) return;
    if (answer.data.count !== count) {
      stale.add(page);
      return;
    }
    const start = (page - 1) * PAGE_SIZE;
    answer.data.results.slice(0, Math.max(0, count - start)).forEach((photo, j) => {
      photos[start + j] = photo;
    });
  });
  return { photos, stale };
}

/** Every page a placeholder on screen stands for (placeholder ids are "temp-<index>"). */
export function pagesOnScreen(visibleItems: readonly PigPhoto[]): number[] {
  const pages = new Set<number>();
  visibleItems.forEach(item => {
    if (item.isTemp) pages.add(Math.floor(parseInt(item.id.replace("temp-", ""), 10) / PAGE_SIZE) + 1);
  });
  return [...pages];
}
