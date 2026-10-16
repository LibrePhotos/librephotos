/**
 * The selection menu's "Set album cover" makes the one selected photo the cover: a person's by
 * its hash, a user album's and an event's (#429) by its id. With any other count it does nothing; picking a cover
 * without a selection is the page's "⋮" since #2240.
 */
import { Media } from "@librephotos/api-client";
import type { PigPhoto } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { useSetEventCoverMutation, useSetPersonAlbumCoverMutation } from "../../api_client/albums/hooks";
import type { SetUserAlbumCoverParams } from "../../api_client/albums/types";
import { usePhotoListAlbumCover } from "./usePhotoListAlbumCover";

type SetPersonCover = ReturnType<typeof useSetPersonAlbumCoverMutation>["mutate"];
type SetEventCover = ReturnType<typeof useSetEventCoverMutation>["mutate"];

const stubs = vi.hoisted(() => ({
  person: vi.fn<SetPersonCover>(),
  user: vi.fn<(params: SetUserAlbumCoverParams) => void>(),
  event: vi.fn<SetEventCover>(),
}));

vi.mock("../../api_client/albums/hooks", () => ({
  useSetPersonAlbumCoverMutation: () => ({ mutate: stubs.person }),
  useSetUserAlbumCoverMutation: () => ({ mutate: stubs.user }),
  useSetEventCoverMutation: () => ({ mutate: stubs.event }),
}));

const tile = (id: string): PigPhoto => ({
  id,
  image_hash: `hash-${id}`,
  aspectRatio: 1,
  type: Media.IMAGE,
  is_hdr: false,
  rating: 0,
  shared_to: [],
  isTemp: false,
  has_raw_variant: false,
});

async function setCover(selected: PigPhoto[], kind: "person" | "useralbum" | "event") {
  let set: ReturnType<typeof usePhotoListAlbumCover> | undefined;
  function Host() {
    set = usePhotoListAlbumCover("7", selected);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Host />));
  act(() => set?.(kind));
  await act(async () => root.unmount());
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  stubs.person.mockReset();
  stubs.user.mockReset();
  stubs.event.mockReset();
});

describe("usePhotoListAlbumCover", () => {
  it("sets a person's cover by the photo's hash", async () => {
    await setCover([tile("a")], "person");

    expect(stubs.person).toHaveBeenCalledWith({ id: "7", cover_photo: "hash-a" });
    expect(stubs.user).not.toHaveBeenCalled();
  });

  it("sets a user album's cover by the photo's id", async () => {
    await setCover([tile("a")], "useralbum");

    expect(stubs.user).toHaveBeenCalledWith({ id: "7", photo: "a" });
    expect(stubs.person).not.toHaveBeenCalled();
  });

  it("sets an event's cover by the photo's id", async () => {
    await setCover([tile("a")], "event");

    expect(stubs.event).toHaveBeenCalledWith({ id: "7", photo: "a" });
    expect(stubs.user).not.toHaveBeenCalled();
  });

  it.each([
    ["nothing", []],
    ["two photos", [tile("a"), tile("b")]],
  ])("does nothing with %s selected", async (_label, selected) => {
    await setCover(selected, "useralbum");
    await setCover(selected, "person");
    await setCover(selected, "event");

    expect(stubs.user).not.toHaveBeenCalled();
    expect(stubs.person).not.toHaveBeenCalled();
    expect(stubs.event).not.toHaveBeenCalled();
  });
});
