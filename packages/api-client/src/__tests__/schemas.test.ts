import { describe, expect, it } from "vitest";
import dateAlbumsList from "./fixtures/dateAlbumsList.json";
import loginResponse from "./fixtures/loginResponse.json";
import userFixture from "./fixtures/user.json";
import {
  FetchDateAlbumsListResponse,
  LoginResponse,
  Media,
  Photoset,
  User,
  imageHashOf,
} from "../schemas";
import { photosetToFilter } from "../endpoints";

describe("schema parsing against fixtures", () => {
  it("parses a date-albums (timeline) list", () => {
    const parsed = FetchDateAlbumsListResponse.parse(dateAlbumsList);
    expect(parsed.results).toHaveLength(2);
    const first = parsed.results[0]!;
    expect(first.id).toBe("2024-06-15");
    expect(first.items[0]!.type).toBe(Media.IMAGE);
    // defaults applied by zod
    expect(first.items[0]!.isTemp).toBe(false);
    expect(first.items[0]!.shared_to).toEqual([]);
    // the null-date "no timestamp" bucket is allowed
    expect(parsed.results[1]!.date).toBeNull();
  });

  it("parses a login response", () => {
    const parsed = LoginResponse.parse(loginResponse);
    expect(parsed.access).toContain("eyJ");
    expect(parsed.refresh).toBe("refresh-token-value");
  });

  it("parses a full user record", () => {
    const parsed = User.parse(userFixture);
    expect(parsed.username).toBe("admin");
    // schema defaults for fields the fixture omits
    expect(parsed.stack_raw_jpeg).toBe(true);
    expect(parsed.text_alignment).toBe("right");
    expect(parsed.duplicate_sensitivity).toBe("normal");
  });

  it("rejects malformed data loudly (server drift)", () => {
    const bad = { results: [{ id: 5, items: "not-an-array" }] };
    expect(() => FetchDateAlbumsListResponse.parse(bad)).toThrow();
  });
});

describe("helpers", () => {
  it("extracts the image hash from a ;-delimited url", () => {
    expect(imageHashOf({ image_hash: "fallback", url: "realhash;variant" })).toBe("realhash");
    expect(imageHashOf({ image_hash: "fallback", url: undefined })).toBe("fallback");
  });

  it("maps photosets onto backend boolean filters", () => {
    expect(photosetToFilter(Photoset.FAVORITES).favorite).toBe(true);
    expect(photosetToFilter(Photoset.VIDEOS).video).toBe(true);
    expect(photosetToFilter(Photoset.TIMESTAMP).favorite).toBeUndefined();
  });
});
