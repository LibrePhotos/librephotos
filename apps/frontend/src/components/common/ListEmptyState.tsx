import React from "react";
import { EmptyState, type EmptyStateProps } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import type { ListFailure } from "./useListFailure";

type ListEmptyStateProps = EmptyStateProps &
  Readonly<{
    /** From `useListFailure`: set when the list's request failed, so "nothing here" would be wrong. */
    failure: ListFailure | undefined;
  }>;

/** The empty state of a list that comes from a query: its `ErrorState` instead when the query failed. */
export function ListEmptyState({ failure, ...emptyState }: ListEmptyStateProps) {
  return failure ? <ErrorState failure={failure} /> : <EmptyState {...emptyState} />;
}
