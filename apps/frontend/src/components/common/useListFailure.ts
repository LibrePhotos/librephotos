import { useMemo } from "react";

/** What a failed list hands `ErrorState` (and `PhotoListView`'s `error` prop). */
export type ListFailure = Readonly<{
  onRetry: () => void;
  /** The retry is out: the button shows a spinner instead of taking more clicks. */
  retrying: boolean;
}>;

type FailableQuery = Readonly<{
  isError: boolean;
  isFetching: boolean;
  data: unknown;
  refetch: () => Promise<unknown>;
}>;

/**
 * The failure to show for a list query, or undefined while there is nothing to
 * report: a query that failed before any data arrived. A failed background
 * refetch also sets `isError`, but the data still on screen stays (as on the
 * album pages), so that is not a failure to show. Memoised, so a memoised list
 * such as `PhotoListView` does not re-render for it.
 */
export function useListFailure({ isError, isFetching, data, refetch }: FailableQuery): ListFailure | undefined {
  const failed = isError && data === undefined;
  return useMemo(
    () => (failed ? { onRetry: () => void refetch(), retrying: isFetching } : undefined),
    [failed, isFetching, refetch]
  );
}
