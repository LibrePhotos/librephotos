/**
 * The directory tree endpoints (issue #2347): the server's folders for the scan directory picker
 * and the user's Nextcloud folders, against what api/views/user.py RootPathTreeView and
 * nextcloud/views.py ListDir answered in a test run.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { defined } from "./defined";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";

const tree = [
  {
    title: "photos",
    absolute_path: "/data/photos",
    children: [
      {
        title: "2023",
        absolute_path: "/data/photos/2023",
        children: [{ title: "january", absolute_path: "/data/photos/2023/january", children: [] }],
      },
      { title: "2024", absolute_path: "/data/photos/2024", children: [] },
    ],
  },
];

describe("directory trees", () => {
  it("reads a nested tree", async () => {
    const { client } = fakeServer(tree);
    const folders = await endpoints.fetchDirTree(client, "/data/photos");
    expect(defined(defined(defined(folders[0]).children[0]).children[0]).title).toBe("january");
  });

  it("always sends the path, blank for the data root", async () => {
    const { client, requests } = fakeServer([]);
    await endpoints.fetchDirTree(client, "");
    expect(defined(requests[0]).url).toBe(`${API}/dirtree/?path=`);
  });

  it("encodes a folder name that would cut the query short", async () => {
    const { client, requests } = fakeServer([]);
    await endpoints.fetchDirTree(client, "/data/a&b #1+");
    expect(defined(requests[0]).url).toBe(`${API}/dirtree/?path=%2Fdata%2Fa%26b%20%231%2B`);
  });

  it("makes a folder and reads its parent listed again (#2035)", async () => {
    const parent = { title: "photos", absolute_path: "/data/photos", children: [] };
    const { client, requests } = fakeServer({ absolute_path: "/data/photos/sam", parent });
    const created = await endpoints.createFolder(client, "/data/photos", "sam");
    expect(defined(requests[0])).toMatchObject({
      url: `${API}/dirtree/folders/`,
      method: "POST",
      body: { parent_path: "/data/photos", name: "sam" },
    });
    expect(created).toEqual({ absolute_path: "/data/photos/sam", parent });
  });

  it("lists the top of the user's Nextcloud", async () => {
    const { client, requests } = fakeServer([{ title: "Photos", absolute_path: "/Photos", children: [] }]);
    const folders = await endpoints.fetchNextcloudDirs(client);
    expect(defined(requests[0]).url).toBe(`${API}/nextcloud/listdir/?fpath=/`);
    expect(folders).toHaveLength(1);
  });
});
