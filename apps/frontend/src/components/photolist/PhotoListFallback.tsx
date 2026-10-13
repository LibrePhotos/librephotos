import React from "react";
import { EmptyState } from "../common/EmptyState";
import { ErrorState } from "../common/ErrorState";
import type { ListFailure } from "../common/useListFailure";
import type { EmptyStateConfig } from "./PhotoListView";

type Props = Readonly<{
  isLoading: boolean;
  error?: ListFailure;
  emptyStateConfig?: EmptyStateConfig;
  /** DefaultHeader shows the setup welcome: an empty state would say the same twice. */
  isFirstTimeSetup: boolean;
}>;

/** What a photo list shows without photos: the failure, the page's empty state, or nothing. */
export function PhotoListFallback({ isLoading, error, emptyStateConfig, isFirstTimeSetup }: Props) {
  if (isLoading) return <div />;
  if (error) return <ErrorState failure={error} />;
  if (!emptyStateConfig || isFirstTimeSetup) return <div />;
  return (
    <EmptyState
      icon={emptyStateConfig.icon}
      title={emptyStateConfig.title}
      description={emptyStateConfig.description}
      actionLabel={emptyStateConfig.actionLabel}
      actionLink={emptyStateConfig.actionLink}
      onAction={emptyStateConfig.onAction}
      progress={emptyStateConfig.progress}
    />
  );
}
