/**
 * The share dialogs filter the user list as you type. The filter used to build
 * a RegExp straight from the input, so "(", "+", "[" or a trailing "\" threw
 * during render and replaced the page with "Something went wrong!".
 */
import { describe, expect, it } from "vitest";
import type { User } from "../../api_client/user/types";
import filterUsers from "./utils";

const users = [
  { id: 1, username: "admin", first_name: "Alex", last_name: "Admin" },
  { id: 2, username: "jdoe", first_name: "John", last_name: "Doe" },
  { id: 3, username: "mara", first_name: "", last_name: "" },
] as User[];

const names = (list: User[]) => list.map(user => user.username);

describe("filterUsers", () => {
  it.each(["(", ")", "john+", "[", "*", "?", "a\\", " ", "  ", "\t"])("does not throw on %j", input => {
    expect(() => filterUsers(input, 0, users)).not.toThrow();
  });

  it("finds nobody for special characters no name contains", () => {
    expect(filterUsers("(", 0, users)).toEqual([]);
    expect(filterUsers("john+", 0, users)).toEqual([]);
  });

  it("matches the username or the full name as a loose subsequence, ignoring case", () => {
    expect(names(filterUsers("jd", 0, users))).toEqual(["jdoe"]);
    expect(names(filterUsers("John Doe", 0, users))).toEqual(["jdoe"]);
    expect(names(filterUsers("AD", 0, users))).toEqual(["admin"]);
    expect(names(filterUsers("ma", 0, users))).toEqual(["mara"]);
  });

  it("lists everyone but the excluded user for an empty filter", () => {
    expect(names(filterUsers("", 1, users))).toEqual(["jdoe", "mara"]);
  });

  // A space typed first used to throw inside fuzzyMatch and take the share dialog down.
  it("treats a filter of only spaces like an empty one", () => {
    expect(names(filterUsers(" ", 1, users))).toEqual(["jdoe", "mara"]);
    expect(names(filterUsers("  ", 1, users))).toEqual(["jdoe", "mara"]);
  });

  it("always leaves out the excluded user", () => {
    expect(names(filterUsers("a", 3, users))).toEqual(["admin"]);
  });
});
