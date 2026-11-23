import type { UserAlbumSort as LocalDbUserAlbumSort } from "@librephotos/local-db";
import { USER_ALBUM_SORTS, isUserAlbumSort, type UserAlbumSort } from "./albumSort";

const sameSorts: [UserAlbumSort, LocalDbUserAlbumSort] extends [LocalDbUserAlbumSort, UserAlbumSort] ? true : false = true;

describe("user album sorts", () => {
  it("validates a persisted sort value", () => {
    expect(sameSorts).toBe(true);
    for (const sort of USER_ALBUM_SORTS) expect(isUserAlbumSort(sort)).toBe(true);
    expect(isUserAlbumSort("date")).toBe(false);
    expect(isUserAlbumSort(3)).toBe(false);
  });
});
