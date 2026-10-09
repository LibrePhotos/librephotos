import { User } from "../../api_client/user/types";
import { fuzzyMatch } from "../../util/util";

// The shared matcher escapes what it is given: a local copy built a RegExp
// straight from the typed text, so "(" or "+" threw during render and took the
// whole page down.
export default function filterUsers(username: string, excludeUserId: number, users: User[] = []): User[] {
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
