import type { Href, Router } from "expo-router";

/** The slice of the expo-router `Router` a back button actually needs. */
export type BackCapableRouter = Pick<Router, "back" | "replace"> & {
  canGoBack?: () => boolean;
};

/**
 * Pop the navigation stack, or fall back to `fallback` when there is nothing to
 * pop.
 *
 * `router.back()` throws ("The 'GO_BACK' action was not handled by any
 * navigator") whenever the current screen is the first one in its stack — which
 * happens far more often than it looks: a deep link, a notification tap, or the
 * cold-start route all mount a screen with no history behind it. Every back
 * affordance in the app must go through this helper.
 */
export function goBackOr(router: BackCapableRouter, fallback: Href): void {
  if (router.canGoBack?.() ?? false) {
    router.back();
    return;
  }
  router.replace(fallback);
}
