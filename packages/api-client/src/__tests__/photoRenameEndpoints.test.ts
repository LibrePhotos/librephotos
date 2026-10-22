/** Renaming photos after their capture date (#2773) and moving them into dated folders (#2774). */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { defined } from "./defined";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";
const PATTERN = "{year}{month}{day}_{hour}{minute}{second}";

describe("renaming photos", () => {
  it("previews the rename of a selection", async () => {
    const preview = {
      photos: 1,
      files: 2,
      unchanged: 0,
      undated: 1,
      undated_hashes: ["h2"],
      numbered: 0,
      no_free_name: 0,
      refused: [],
      rows: [
        {
          photo_id: "0b7a3d52-3c55-4c1f-9d7e-2b8f1e7a9c10",
          image_hash: "h1",
          name: "IMG_1.jpg",
          new_name: "20250601_233000.jpg",
          other_files: 1,
          status: "rename",
          number: 0,
          reason: null,
        },
      ],
    };
    const { client, requests } = fakeServer(preview);
    expect(await endpoints.previewPhotosRename(client, ["h1"], PATTERN)).toEqual(preview);
    expect(defined(requests[0])).toEqual({
      url: `${API}/photos/rename/preview/`,
      method: "POST",
      body: { image_hashes: ["h1"], pattern: PATTERN },
    });
  });

  it("renames in the request or starts the job", async () => {
    const renamed = { renamed: 1, unchanged: 0, undated: 0, refused: 0, failed: 0 };
    const { client, requests } = fakeServer(renamed);
    expect(await endpoints.renamePhotos(client, [], PATTERN, { query: { folder: "/p" }, excludedHashes: [] })).toEqual(
      renamed
    );
    expect(defined(requests[0]).body).toEqual({
      select_all: true,
      query: { folder: "/p" },
      excluded_hashes: [],
      pattern: PATTERN,
    });
    const started = fakeServer({ job_id: "j1" }, 202);
    expect(await endpoints.renamePhotos(started.client, ["h1"], PATTERN)).toEqual({ job_id: "j1" });
  });
});

describe("moving photos into dated folders", () => {
  it("sends the folder pattern and reads the folders", async () => {
    const preview = {
      target_folder: "/photos/sorted",
      photos: 1,
      files: 1,
      unchanged: 0,
      refused: [],
      clashes: [],
      undated: 2,
      undated_hashes: ["h2", "h3"],
      folders: [{ path: "/photos/sorted/2025/06", photos: 1, unchanged: 0, clashes: 0, new: true }],
    };
    const { client, requests } = fakeServer(preview);
    const target = { targetFolder: "/photos/sorted", folderPattern: "{year}/{month}" };
    expect(await endpoints.previewPhotosMove(client, ["h1"], target)).toEqual(preview);
    expect(defined(requests[0]).body).toEqual({
      image_hashes: ["h1"],
      target_folder: "/photos/sorted",
      folder_pattern: "{year}/{month}",
    });
  });
});
