import type { User } from "@librephotos/api-client";

/** The highest star rating; 0 is "no rating". */
export const MAX_RATING = 5;

/** Every rating a photo can have, highest first, as the "Set rating" menu lists them. */
export const RATINGS_HIGHEST_FIRST = [5, 4, 3, 2, 1, 0] as const;

/**
 * Whether a photo with `rating` is one of the user's favorites: its rating is
 * at least the user's favorite threshold. False until the user has loaded, so
 * no photo shows as a favorite on a guessed threshold.
 */
export function isFavorite(rating: number, user: Pick<User, "favorite_min_rating"> | undefined): boolean {
  return user !== undefined && rating >= user.favorite_min_rating;
}

/**
 * Whether the user rates photos with 1 to 5 stars instead of the favorite
 * toggle (#2202). In that mode the web never calls /photosedit/favorite/,
 * whose un-favorite sets the rating to 0. False until the user has loaded.
 */
export function ratesWithStars(user: Pick<User, "rating_mode"> | undefined): boolean {
  return user?.rating_mode === "stars";
}
