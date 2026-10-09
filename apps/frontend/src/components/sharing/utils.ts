import type { User } from "../../api_client/user/types";
import { fuzzyMatch } from "../../util/util";

// The shared matcher escapes what it is given: a local copy built a RegExp
// straight from the typed text, so "(" or "+" threw during render and took the
// whole page down.
// Generic over the row shape: the user list gives non-admins only the public
// fields (ListUser), which still carry everything matched on here.
export default function filterUsers<U extends Pick<User, "id" | "username" | "first_name" | "last_name">>(
  username: string,
  excludeUserId: number,
  users: readonly U[] = []
): U[] {
  return users
    .filter(user => {
      // fuzzyMatch drops whitespace and throws on a query with nothing left, so a
      // filter of only spaces lists everyone, like an empty one.
      if (username.trim().length === 0) {
        return true;
      }
      return fuzzyMatch(username, user.username) || fuzzyMatch(username, `${user.first_name} ${user.last_name}`);
    })
    .filter(user => user.id !== excludeUserId);
}
