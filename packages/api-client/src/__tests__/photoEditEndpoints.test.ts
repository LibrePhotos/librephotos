/**
 * Photo edits: the recipe schema's ranges and strictness, the edit resource, and its four routes.
 * photoEdit.json is what GET /api/photos/{photo_id}/edit/ answered for a saved edit once its
 * rendition was ready (a backend test client, 2026-11-12).
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { photoKeys } from "../hooks/queryKeys";
import { EditRecipe, Photo, PhotoEditUpdate } from "../schemas";
import { defined } from "./defined";
import photoEdit from "./fixtures/photoEdit.json";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";
const PHOTO_ID = "4f1c2d3e-0000-4000-8000-000000000001";

const step = {
  action: "set",
  control: "light.exposure",
  value: 0.35,
  at: "2026-11-12T09:30:00Z",
  settings: { version: 1, light: { exposure: 0.35 } },
};

const edit = {
  photo_id: PHOTO_ID,
  settings: { version: 1, light: { exposure: 0.35 } },
  history: [step],
  history_cursor: 0,
  version: 3,
  rendition: "pending",
  updated_at: "2026-11-12T09:30:00Z",
};

describe("edit recipe", () => {
  it("takes the default recipe and a full one", () => {
    expect(EditRecipe.parse({ version: 1 })).toEqual({ version: 1 });
    const full = {
      version: 1,
      geometry: {
        orientation: 270,
        flip_h: true,
        flip_v: false,
        straighten: -45,
        crop: { cx: 0.5, cy: 0.4, w: 0.8, h: 0.6 },
        aspect: "16:10",
      },
      wb: { temp: -100, tint: 100 },
      light: { exposure: 5, contrast: 10, highlights: -100, shadows: 100, whites: 1, blacks: -1 },
      curve: {
        master: [
          [0, 0.1],
          [0.5, 0.6],
          [1, 0.9],
        ],
        red: [
          [0, 0],
          [1, 1],
        ],
      },
      color: { vibrance: 20, saturation: -20, treatment: "bw" },
      mixer: { red: { hue: 10 }, magenta: { sat: -5, lum: 3 } },
      bw_mix: { aqua: 40 },
      grading: { shadows: { hue: 360, sat: 100, lum: -100 }, blending: 0, balance: 100 },
      effects: { texture: 1, clarity: 2, dehaze: -3 },
      vignette: { amount: -100, midpoint: 0, feather: 100, roundness: -100 },
      grain: { amount: 100, size: 0, roughness: 100, seed: 4294967295 },
      detail: { sharpen_amount: 150, sharpen_radius: 0.5, nr_luminance: 100, nr_color: 0 },
    };
    expect(EditRecipe.parse(full)).toEqual(full);
  });

  it.each([
    ["an unknown key", { version: 1, light: { brilliance: 3 } }],
    ["an unknown group", { version: 1, frame: {} }],
    ["another version", { version: 2 }],
    ["a number out of range", { version: 1, light: { exposure: 5.01 } }],
    ["an orientation that is not a quarter turn", { version: 1, geometry: { orientation: 45 } }],
    ["a seed that is not an integer", { version: 1, grain: { seed: 1.5 } }],
    ["a curve with one point", { version: 1, curve: { master: [[0, 0]] } }],
    [
      "a curve whose x does not increase",
      {
        version: 1,
        curve: {
          master: [
            [0, 0],
            [0.5, 1],
            [0.5, 0.2],
          ],
        },
      },
    ],
    ["a crop outside 0 to 1", { version: 1, geometry: { crop: { cx: 0.5, cy: 0.5, w: 1.2, h: 1 } } }],
    ["a crop of no width", { version: 1, geometry: { crop: { cx: 0.5, cy: 0.5, w: 0, h: 1 } } }],
    ["an unknown aspect", { version: 1, geometry: { aspect: "3:7" } }],
  ])("rejects %s", (_what, recipe) => {
    expect(EditRecipe.safeParse(recipe).success).toBe(false);
  });
});

describe("photo edit endpoints", () => {
  it("reads a photo's edit by the photo's id", async () => {
    const { client, requests } = fakeServer(edit);
    expect(await endpoints.fetchPhotoEdit(client, PHOTO_ID)).toEqual(edit);
    expect(defined(requests[0])).toEqual({ url: `${API}/photos/${PHOTO_ID}/edit/`, method: "GET", body: undefined });
  });

  it("reads a photo never edited as the default recipe at version 0", async () => {
    const never = {
      photo_id: PHOTO_ID,
      settings: { version: 1 },
      history: [],
      history_cursor: -1,
      version: 0,
      rendition: "none",
      updated_at: null,
    };
    const { client } = fakeServer(never);
    expect(await endpoints.fetchPhotoEdit(client, PHOTO_ID)).toEqual(never);
  });

  it("reads a saved edit as the backend answers it: several groups, a crop, a curve, three steps", async () => {
    const { client } = fakeServer(photoEdit);
    const read = await endpoints.fetchPhotoEdit(client, photoEdit.photo_id);
    expect(read).toEqual(photoEdit);
    expect(read.settings.geometry?.crop).toEqual({ cx: 0.52, cy: 0.48, w: 0.8, h: 0.6 });
    expect(read.settings.curve?.master).toHaveLength(3);
    expect(read.history.map(step => step.action)).toEqual(["set", "crop", "preset"]);
    expect(read.history_cursor).toBe(2);
    expect(read.history[read.history_cursor]?.settings).toEqual(read.settings);
  });

  it("sends a saved edit back unchanged with PUT", async () => {
    const { client, requests } = fakeServer(photoEdit);
    const body = PhotoEditUpdate.parse(photoEdit);
    expect(Object.keys(body).sort()).toEqual(["history", "history_cursor", "settings"]);
    await endpoints.savePhotoEdit(client, photoEdit.photo_id, body);
    expect(defined(requests[0]).body).toEqual({
      settings: photoEdit.settings,
      history: photoEdit.history,
      history_cursor: photoEdit.history_cursor,
    });
  });

  it("saves the recipe, the history and the cursor with PUT", async () => {
    const { client, requests } = fakeServer(edit);
    const body = PhotoEditUpdate.parse({ settings: edit.settings, history: edit.history, history_cursor: 0 });
    expect(await endpoints.savePhotoEdit(client, PHOTO_ID, body)).toEqual(edit);
    expect(defined(requests[0])).toEqual({ url: `${API}/photos/${PHOTO_ID}/edit/`, method: "PUT", body });
  });

  it("deletes a photo's edit (204, no body)", async () => {
    const { client, requests } = fakeServer(null);
    await expect(endpoints.deletePhotoEdit(client, PHOTO_ID)).resolves.toBeUndefined();
    expect(defined(requests[0])).toMatchObject({ url: `${API}/photos/${PHOTO_ID}/edit/`, method: "DELETE" });
  });

  it("fetches the edit source as bytes", async () => {
    const { client, requests } = fakeServer("LPES");
    const bytes = new Uint8Array(await endpoints.fetchPhotoEditSource(client, PHOTO_ID));
    expect(new TextDecoder().decode(bytes)).toBe('"LPES"');
    expect(defined(requests[0]).url).toBe(`${API}/photos/${PHOTO_ID}/edit/source/`);
  });

  it("rejects a saved edit whose recipe the server got wrong", async () => {
    const { client } = fakeServer({ ...edit, settings: { version: 1, light: { exposure: 9 } } });
    await expect(endpoints.fetchPhotoEdit(client, PHOTO_ID)).rejects.toThrow(/photo edit/);
  });

  it("keys a photo's edit under the photo family", () => {
    expect(photoKeys.edit(PHOTO_ID)).toEqual(["photos", "edit", PHOTO_ID]);
  });
});

describe("Photo.edit", () => {
  it("is optional, null, or the edited picture's version, state and size", () => {
    const shape = Photo.shape.edit;
    expect(shape.parse(undefined)).toBeUndefined();
    expect(shape.parse(null)).toBeNull();
    // As the photo detail carried it for photoEdit.json's photo.
    const summary = { version: 1, rendition: "ready", width: 64, height: 72 };
    expect(shape.parse(summary)).toEqual(summary);
  });
});
