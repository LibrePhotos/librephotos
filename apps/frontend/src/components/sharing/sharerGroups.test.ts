import { Media, type PigPhoto } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { formatDateForPhotoGroups } from "../../util/util";
import { sharerName, sharerPhotoGroups } from "./sharerGroups";

const photo = (id: string): PigPhoto => ({
  id,
  image_hash: id,
  url: id,
  aspectRatio: 1,
  type: Media.IMAGE,
  is_hdr: false,
  rating: 0,
  shared_to: [],
  isTemp: false,
  has_raw_variant: false,
});

const users = [
  { id: 1, username: "alice", first_name: "Alice", last_name: "Archer" },
  { id: 2, username: "bob", first_name: "", last_name: "" },
];

describe("sharerName", () => {
  it("prefers the full name, then the username, then the fallback", () => {
    expect(sharerName(users[0], "?")).toBe("Alice Archer");
    expect(sharerName(users[1], "?")).toBe("bob");
    expect(sharerName(undefined, "user(3)")).toBe("user(3)");
  });
});

describe("sharerPhotoGroups", () => {
  const groups = sharerPhotoGroups(
    [
      { userId: 1, photos: [photo("a"), photo("b")] },
      { userId: 3, photos: [photo("c")] },
    ],
    users,
    { fallbackName: userId => `user(${userId})`, countLabel: count => `${count} photos` }
  );

  it("makes one photo group per user, named where a date group shows its place", () => {
    expect(groups.map(group => [group.id, group.location, group.date, group.items.length])).toEqual([
      ["user-1", "Alice Archer", "2 photos", 2],
      ["user-3", "user(3)", "1 photos", 1],
    ]);
  });

  it("keeps the count as it is when the photo list formats its groups as dates", () => {
    expect(formatDateForPhotoGroups(groups).map(group => group.date)).toEqual(["2 photos", "1 photos"]);
  });
});
