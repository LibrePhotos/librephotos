/** Moving photos to another folder of the library (#352): the preview, the move and the folder picker. */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { defined } from "./defined";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";
const moved = { target_folder: "/photos/b", moved: 2, skipped: 0, unchanged: 1, refused: 0, failed: 0 };

describe("moving photos", () => {
  it("previews the move of a selection", async () => {
    const preview = {
      target_folder: "/photos/b",
      photos: 2,
      files: 5,
      unchanged: 0,
      refused: [{ reason: "nextcloud", photos: 1 }],
      clashes: [{ photo_id: "0b7a3d52-3c55-4c1f-9d7e-2b8f1e7a9c10", name: "IMG_1.jpg", renamed_to: "IMG_1 (1).jpg" }],
    };
    const { client, requests } = fakeServer(preview);
    expect(await endpoints.previewPhotosMove(client, ["h1"], "/photos/b")).toEqual(preview);
    expect(defined(requests[0])).toEqual({
      url: `${API}/photos/move/preview/`,
      method: "POST",
      body: { image_hashes: ["h1"], target_folder: "/photos/b" },
    });
  });

  it("sends the choice for taken names only when there is one", async () => {
    const { client, requests } = fakeServer(moved);
    expect(await endpoints.movePhotos(client, ["h1"], { targetFolder: "/photos/b" })).toEqual(moved);
    await endpoints.movePhotos(
      client,
      [],
      { targetFolder: "/photos/b", onConflict: "rename" },
      { query: { folder: "/photos/a" }, excludedHashes: [] }
    );
    expect(defined(requests[0]).body).toEqual({ image_hashes: ["h1"], target_folder: "/photos/b" });
    expect(defined(requests[1]).body).toEqual({
      select_all: true,
      query: { folder: "/photos/a" },
      excluded_hashes: [],
      target_folder: "/photos/b",
      on_conflict: "rename",
    });
  });

  it("reads the job a large move starts", async () => {
    const { client } = fakeServer({ job_id: "j1", target_folder: "/photos/b" }, 202);
    expect(await endpoints.movePhotos(client, ["h1"], { targetFolder: "/photos/b" })).toEqual({
      job_id: "j1",
      target_folder: "/photos/b",
    });
  });

  it("lists the library folders, then one folder", async () => {
    const listing = {
      path: null,
      folders: [{ name: "photos", path: "/photos", has_subfolders: true }],
      truncated: false,
    };
    const { client, requests } = fakeServer(listing);
    expect(await endpoints.fetchMoveFolders(client, null)).toEqual(listing);
    await endpoints.fetchMoveFolders(client, "/photos/a b");
    expect(defined(requests[0]).url).toBe(`${API}/photos/move/folders/`);
    expect(defined(requests[1]).url).toBe(`${API}/photos/move/folders/?path=%2Fphotos%2Fa+b`);
  });
});
