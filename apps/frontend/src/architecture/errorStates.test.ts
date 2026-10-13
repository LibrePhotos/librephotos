/**
 * A list whose request failed must not show its empty state: "No photos yet" on a server that
 * answered 502 reads like data loss, with no way to try again (#2221). AGENTS.md, "Loading and
 * errors": a component that reads a query and shows an empty state also shows the failure, through
 * `useListFailure` and one of
 *
 * - `<ErrorState failure={...} />` (`compact` in a card or a table row),
 * - `<ListEmptyState failure={...} ... />`, the empty state that turns into the error state,
 * - `PhotoListView`'s `error={...}` prop, next to its `emptyStateConfig`.
 *
 * This test finds a component file that calls a `use...Query(` hook and renders `<EmptyState` or
 * passes `emptyStateConfig=`, but uses none of the three. ALLOW_LIST holds the files whose empty
 * state is not a list's, with the reason; it only shrinks.
 */
import { describe, expect, it } from "vitest";

const ALLOW_LIST = new Map<string, string>([
  // Its empty state is for a user without admin rights, not for an empty list.
  ["/src/components/settings/AdminPage.tsx", "the EmptyState is the unauthorized page"],
  // Detail pages: a failed request shows the job's or album's not-found state already.
  ["/src/components/job/JobDetailView.tsx", "failure shows the not-found state"],
  ["/src/routes/_protected/album/events.$id.tsx", "failure shows the not-found state"],
  ["/src/routes/_protected/album/places.$id.tsx", "failure shows the not-found state"],
  ["/src/routes/_protected/album/tags.$id.tsx", "failure shows the not-found state"],
  ["/src/routes/_protected/album/things.$id.tsx", "failure shows the not-found state"],
  ["/src/routes/_protected/album/user.$id.tsx", "failure shows the not-found state"],
]);

const READS_QUERY = /\buse\w+Query\(|\buseAllFolderSubfolders\(/;
const SHOWS_EMPTY = /<EmptyState\b|\bemptyStateConfig=/;
const SHOWS_FAILURE = /<ErrorState\b|<ListEmptyState\b|\serror=\{/;

function hidesFailures(source: string): boolean {
  return READS_QUERY.test(source) && SHOWS_EMPTY.test(source) && !SHOWS_FAILURE.test(source);
}

const sources = import.meta.glob<string>(["/src/**/*.tsx", "!/src/**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("list empty states", () => {
  it("show a failed request as an error with Retry, outside the allow-list", () => {
    const offenders = Object.entries(sources)
      .filter(([path, source]) => !ALLOW_LIST.has(path) && hidesFailures(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("leave the allow-list once they are converted, renamed or deleted", () => {
    const stale = [...ALLOW_LIST.keys()].filter(path => {
      const source = sources[path];
      return source === undefined || !hidesFailures(source);
    });

    expect(stale).toEqual([]);
  });

  it("flags a query's empty state without a failure, and passes one with it", () => {
    const planted = `
      const { data, isLoading } = useFetchTagsQuery();
      return !isLoading && !data?.length ? <EmptyState title="" description="" /> : <Grid />;`;
    expect(hidesFailures(planted)).toBe(true);

    const grid = `
      const query = useFetchTagsQuery();
      const listFailure = useListFailure(query);
      return <PhotoListView emptyStateConfig={config} error={listFailure} />;`;
    expect(hidesFailures(grid)).toBe(false);
    expect(hidesFailures(planted.replace("<EmptyState", "<ListEmptyState failure={f}"))).toBe(false);
  });
});
