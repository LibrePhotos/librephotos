import { describe, expect, it } from "vitest";
import { isFavorite, ratesWithStars } from "./rating";

describe("isFavorite", () => {
  const user = { favorite_min_rating: 4 };

  it("is false until the user has loaded, whatever the rating", () => {
    expect(isFavorite(5, undefined)).toBe(false);
    expect(isFavorite(0, undefined)).toBe(false);
  });

  it("is false below the threshold", () => {
    expect(isFavorite(3, user)).toBe(false);
  });

  it("is true at and above the threshold", () => {
    expect(isFavorite(4, user)).toBe(true);
    expect(isFavorite(5, user)).toBe(true);
  });
});

describe("ratesWithStars", () => {
  it("is true only for a loaded user in stars mode", () => {
    expect(ratesWithStars(undefined)).toBe(false);
    expect(ratesWithStars({ rating_mode: "favorite" })).toBe(false);
    expect(ratesWithStars({ rating_mode: "stars" })).toBe(true);
  });
});
