import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import type { EmptyStateConfig } from "../photolist/PhotoListView";

/**
 * What an album page shows when its album cannot be loaded: deleted, no longer
 * shared, or rebuilt under a new id (events, places). Without it the page sat
 * on "Loading..." for good, or on an empty album that looked like a real one.
 */
export function albumNotFoundState(
  t: TFunction,
  icon: ReactNode,
  backLink: string,
  backLabel: string = t("emptystate.albumnotfound.action")
): EmptyStateConfig {
  return {
    icon,
    title: t("emptystate.albumnotfound.title"),
    description: t("emptystate.albumnotfound.description"),
    actionLabel: backLabel,
    actionLink: backLink,
  };
}
