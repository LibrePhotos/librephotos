import type { SearchFilters } from "@librephotos/api-client";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { ratesWithStars } from "../../util/rating";
import { CLEARED_SEARCH_FILTERS, validateSearchFilters } from "./searchFilter";

/**
 * The search page's filters, read from and written to the URL. A change is a new history entry,
 * so Back undoes it; the words and the media type are left as they are.
 */
export function useSearchFilters() {
  const navigate = useNavigate();
  const rawSearch = useSearch({ strict: false });
  // The router keeps the search object's identity until it changes, so `filters` is stable too.
  const filters = useMemo(() => validateSearchFilters(rawSearch), [rawSearch]);

  const setFilters = useCallback(
    (patch: SearchFilters) => {
      void navigate({ to: ".", search: prev => ({ ...prev, ...patch }) });
    },
    [navigate]
  );
  const clearFilters = useCallback(() => setFilters(CLEARED_SEARCH_FILTERS), [setFilters]);

  return { filters, setFilters, clearFilters };
}

/**
 * The rating a "Favorites only" filter asks for: the user's favorite threshold when they rate
 * with the favorite toggle (#2601), undefined when they rate with stars (the filter offers 1 to 5).
 */
export function useFavoriteRating(): number | undefined {
  const { data: user } = useCurrentUserSelfDetailsQuery();
  if (!user || ratesWithStars(user)) return undefined;
  return user.favorite_min_rating;
}
