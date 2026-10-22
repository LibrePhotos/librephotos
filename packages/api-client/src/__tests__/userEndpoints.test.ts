/**
 * The user endpoints the web and mobile apps share (issue #2347): the request each one sends and
 * the parsed answer, against the backend's answers.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { ListUserList, User } from "../schemas";
import { defined } from "./defined";
import manageUser from "./fixtures/manageUser.json";
import publicUser from "./fixtures/publicUser.json";
import userFixture from "./fixtures/user.json";
import { fakeServer } from "./harness";

/**
 * Issue #1888: since the #1861 authorization fix GET /api/user/ sends the full UserSerializer only
 * to admins (and to a user reading their own record); everyone else gets the public-safe
 * PublicUserSerializer rows. Validating those against the full User schema flooded non-admins
 * with "Required at results.N.<field>" popups on the main page.
 */
describe("the user list (issue #1888)", () => {
  it("documents the symptom: the full User schema rejects a public-safe row", () => {
    const result = User.safeParse(publicUser);
    expect(result.success).toBe(false);
    const missing = result.error?.issues.map(issue => issue.path.join(".")) ?? [];
    expect(missing).toEqual(expect.arrayContaining(["email", "confidence", "date_joined", "photo_count"]));
  });

  it("reads every page, public-safe rows and full admin rows alike", async () => {
    const { client, requests } = fakeServer({
      count: 2,
      next: null,
      previous: null,
      results: [publicUser, { ...userFixture, id: 2, upload_directory: "/data/admin/inbox" }],
    });
    const users = await endpoints.fetchUserList(client);
    expect(defined(requests[0]).url).toBe("https://demo.example.com/api/user/");
    expect(defined(users[0]).username).toBe("alice");
    // zod strips unknown keys: without the field the Edit User dialog showed an empty upload folder.
    expect(defined(users[1]).upload_directory).toBe("/data/admin/inbox");
    expect(ListUserList.parse([publicUser])).toHaveLength(1);
  });
});

describe("your own user", () => {
  it("patches only the fields sent and parses the full user back", async () => {
    const { client, requests } = fakeServer({ ...userFixture, image_scale: 2 });
    const user = await endpoints.updateUserPartial(client, 1, { image_scale: 2 });
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/user/1/",
      method: "PATCH",
      body: { image_scale: 2 },
    });
    expect(user.image_scale).toBe(2);
  });

  it("uploads an avatar as multipart form data", async () => {
    const { client, requests } = fakeServer(userFixture);
    const form = new FormData();
    form.append("avatar", new Blob(["x"]), "me.png");
    await endpoints.updateUserPartial(client, "1", form);
    expect(defined(requests[0]).body).toBe(form);
  });
});

describe("managing users (admin)", () => {
  it("patches another user's record and parses the ManageUser answer", async () => {
    const { client, requests } = fakeServer(manageUser);
    const user = await endpoints.manageUpdateUser(client, 2, { scan_directory: "/data/bob" });
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/manage/user/2/",
      method: "PATCH",
      body: { scan_directory: "/data/bob" },
    });
    expect(user.username).toBe("bob");
  });

  it("asks how many photos a new scan directory leaves outside (#2036)", async () => {
    const { client, requests } = fakeServer({ outside_count: 4136 });
    const impact = await endpoints.fetchScanDirectoryImpact(client, 2, "/data/a&b #1", "");
    expect(defined(requests[0])).toMatchObject({
      url: "https://demo.example.com/api/manage/user/2/scan-directory-impact/?scan_directory=%2Fdata%2Fa%26b%20%231&upload_directory=",
      method: "GET",
    });
    expect(impact.outside_count).toBe(4136);
  });

  it("lists, adds and removes the folders of a library (#123)", async () => {
    const answer = {
      folders: [
        { id: null, path: "/data/anna", kind: "main", available: true, photo_count: 12 },
        { id: 3, path: "/data/family", kind: "folder", available: false, photo_count: 0 },
      ],
      excluded_folders: ["/data/family/trip"],
    };
    const { client, requests } = fakeServer(answer);
    const own = await endpoints.fetchOwnLibraryFolders(client);
    expect(own.folders.map(folder => folder.kind)).toEqual(["main", "folder"]);
    await endpoints.fetchLibraryFolders(client, 2);
    await endpoints.addLibraryFolder(client, 2, "/data/family");
    const left = await endpoints.removeLibraryFolder(client, 2, 3);
    expect(left.folders[1]?.available).toBe(false);
    expect(requests.map(request => [request.method, request.url, request.body])).toEqual([
      ["GET", "https://demo.example.com/api/library-folders/", undefined],
      ["GET", "https://demo.example.com/api/manage/user/2/library-folders/", undefined],
      ["POST", "https://demo.example.com/api/manage/user/2/library-folders/", { path: "/data/family" }],
      ["DELETE", "https://demo.example.com/api/manage/user/2/library-folders/3/", undefined],
    ]);
  });

  it("leaves folders out of the own library and lists a folder's subfolders (#791)", async () => {
    const saved = { folders: [], excluded_folders: ["/data/a/trip"], outside_count: 3 };
    const { client, requests } = fakeServer(saved);
    const answer = await endpoints.setExcludedFolders(client, ["/data/a/trip"]);
    expect(answer.outside_count).toBe(3);
    expect(defined(requests[0])).toEqual({
      url: "https://demo.example.com/api/library-folders/excluded/",
      method: "PUT",
      body: { excluded_folders: ["/data/a/trip"] },
    });

    const listing = {
      path: "/data/a",
      subfolders: [{ name: "trip", path: "/data/a/trip", excluded: true, has_subfolders: false, photo_count: 3 }],
      truncated: false,
    };
    const second = fakeServer(listing);
    const folders = await endpoints.fetchLibrarySubfolders(second.client, "/data/a & b");
    expect(folders.subfolders[0]?.excluded).toBe(true);
    expect(defined(second.requests[0]).url).toBe(
      "https://demo.example.com/api/library-folders/subfolders/?path=%2Fdata%2Fa+%26+b"
    );
  });

  it("deletes a user (204, no body)", async () => {
    const { client, requests } = fakeServer(null);
    await expect(endpoints.deleteUser(client, 2)).resolves.toBeUndefined();
    expect(defined(requests[0])).toMatchObject({
      url: "https://demo.example.com/api/delete/user/2/",
      method: "DELETE",
    });
  });
});
