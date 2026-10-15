/**
 * The hooks the lightbox and the photo page share: the owner's photo
 * actions, rotating in 90° steps, and marking a face the detector missed.
 */
import type { NormalizedFaceBox, Photo, User } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { makePhoto } from "./photoFixture.test-utils";
import { useFaceDrawing } from "./useFaceDrawing";
import { usePhotoActions } from "./usePhotoActions";
import { usePhotoRotation } from "./usePhotoRotation";

type MutateOptions = { onSuccess?: () => void; onError?: () => void };

const stubs = vi.hoisted(() => ({
  favorite: vi.fn<(variables: { image_hashes: string[]; favorite: boolean }) => void>(),
  rating: vi.fn<(variables: { image_hashes: string[]; rating: number }) => void>(),
  user: undefined as Pick<User, "id" | "favorite_min_rating" | "rating_mode"> | undefined,
  hidden: vi.fn<(variables: { image_hashes: string[]; hidden: boolean }) => void>(),
  archived: vi.fn<(variables: { image_hashes: string[]; archived: boolean }) => void>(),
  deleted: vi.fn<(variables: { image_hashes: string[]; deleted: boolean }, options: MutateOptions) => void>(),
  rotate: vi.fn<(variables: { image_hash: string; clockwiseDegrees: number }, options: MutateOptions) => void>(),
  addFace: vi.fn<(variables: { photo: string; personName: string; box: NormalizedFaceBox }) => void>(),
  shares: [{ photo_id: "p1" }],
}));

vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoSharesQuery: (enabled: boolean) => ({ data: enabled ? stubs.shares : undefined }),
  useMarkPhotosDeletedMutation: () => ({ mutate: stubs.deleted }),
  useSetFavoritePhotosMutation: () => ({ mutate: stubs.favorite }),
  useSetPhotosHiddenMutation: () => ({ mutate: stubs.hidden }),
  useSetPhotosArchivedMutation: () => ({ mutate: stubs.archived }),
  useSetPhotosRatingMutation: () => ({ mutate: stubs.rating, isPending: false, variables: undefined }),
}));
vi.mock("../../api_client/photos/hooks/useRotatePhotosMutation", () => ({
  useRotatePhotosMutation: () => ({ mutate: stubs.rotate }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.user }),
}));
vi.mock("../../api_client/faces", () => ({ useAddFaceMutation: () => ({ mutate: stubs.addFace }) }));

const FAVORITE_USER = { id: 1, favorite_min_rating: 4, rating_mode: "favorite" } as const;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  stubs.user = FAVORITE_USER;
});

const unmounts: Array<() => void> = [];

afterEach(() => {
  while (unmounts.length) defined(unmounts.pop())();
  for (const mock of [stubs.favorite, stubs.hidden, stubs.archived, stubs.deleted, stubs.rotate, stubs.addFace])
    mock.mockReset();
  stubs.rating.mockReset();
});

/** Render a hook; `current()` is its latest result, `rerender` gives it new arguments. */
async function renderHook<Args, Result>(useHook: (args: Args) => Result, initial: Args) {
  let latest: { value: Result } | undefined;
  let args = initial;
  function Host() {
    latest = { value: useHook(args) };
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Host />));
  unmounts.push(() => act(() => root.unmount()));
  return {
    current: () => defined(latest).value,
    rerender: async (next: Args) => {
      args = next;
      await act(async () => root.render(<Host />));
    },
  };
}

const photo: Photo = makePhoto({ id: "p1", image_hash: "h1", rating: 4 });

describe("usePhotoActions", () => {
  it("reads the photo's state: a favourite from the user's minimum rating, its share link, the trash", async () => {
    const hook = await renderHook(usePhotoActions, { photoDetail: { ...photo, in_trashcan: true }, isPublic: false });
    expect(hook.current().isFavorite).toBe(true);
    expect(hook.current().isShared).toBe(true);
    expect(hook.current().inTrash).toBe(true);
    await hook.rerender({ photoDetail: { ...photo, rating: 3 }, isPublic: false });
    expect(hook.current().isFavorite).toBe(false);
  });

  it("toggles the favourite, hidden and archived flags and trash, and calls back after the trash", async () => {
    const onAfterTrashToggle = vi.fn<() => void>();
    const hook = await renderHook(usePhotoActions, { photoDetail: photo, isPublic: false, onAfterTrashToggle });
    act(() => hook.current().toggleFavorite());
    expect(stubs.favorite).toHaveBeenCalledWith({ image_hashes: ["h1"], favorite: false });
    act(() => hook.current().toggleHidden());
    expect(stubs.hidden).toHaveBeenCalledWith({ image_hashes: ["h1"], hidden: true });
    act(() => hook.current().toggleArchived());
    expect(stubs.archived).toHaveBeenCalledWith({ image_hashes: ["h1"], archived: true });
    act(() => hook.current().toggleTrash());
    const [variables, options] = defined(stubs.deleted.mock.calls[0]);
    expect(variables).toEqual({ image_hashes: ["h1"], deleted: true });
    options.onSuccess?.();
    expect(onAfterTrashToggle).toHaveBeenCalledTimes(1);
  });

  it("opens and closes the share link dialog for the photo", async () => {
    const hook = await renderHook(usePhotoActions, { photoDetail: photo, isPublic: false });
    act(() => hook.current().openShareLink());
    expect(hook.current().sharingPhotoId).toBe("p1");
    act(() => hook.current().closeShareLink());
    expect(hook.current().sharingPhotoId).toBeNull();
  });

  it("does nothing for a viewer who is not the owner, or without details", async () => {
    const shared = await renderHook(usePhotoActions, { photoDetail: photo, isPublic: true });
    expect(shared.current().isShared).toBe(false);
    act(() => {
      shared.current().toggleFavorite();
      shared.current().toggleHidden();
      shared.current().toggleArchived();
      shared.current().toggleTrash();
      shared.current().openShareLink();
    });
    const none = await renderHook(usePhotoActions, { photoDetail: undefined, isPublic: false });
    act(() => none.current().toggleFavorite());
    expect(stubs.favorite).not.toHaveBeenCalled();
    expect(stubs.hidden).not.toHaveBeenCalled();
    expect(stubs.archived).not.toHaveBeenCalled();
    expect(stubs.deleted).not.toHaveBeenCalled();
    expect(shared.current().sharingPhotoId).toBeNull();
  });
});

describe("usePhotoActions rating (#2202)", () => {
  it("sets the star rating in stars mode and leaves the favourite toggle alone", async () => {
    stubs.user = { ...FAVORITE_USER, rating_mode: "stars" };
    const hook = await renderHook(usePhotoActions, { photoDetail: photo, isPublic: false });
    expect(hook.current().ratesWithStars).toBe(true);
    expect(hook.current().canRate).toBe(true);
    expect(hook.current().rating).toBe(4);
    act(() => {
      hook.current().setRating(2);
      hook.current().toggleFavorite();
    });
    expect(stubs.rating).toHaveBeenCalledWith({ image_hashes: ["h1"], rating: 2 });
    expect(stubs.favorite).not.toHaveBeenCalled();
  });

  it("rates nothing in favourite mode, nor someone else's photo in stars mode", async () => {
    const favoriteMode = await renderHook(usePhotoActions, { photoDetail: photo, isPublic: false });
    act(() => favoriteMode.current().setRating(5));
    stubs.user = { ...FAVORITE_USER, id: 2, rating_mode: "stars" };
    const notOwner = await renderHook(usePhotoActions, { photoDetail: photo, isPublic: false });
    expect(notOwner.current().canRate).toBe(false);
    act(() => notOwner.current().setRating(5));
    expect(stubs.rating).not.toHaveBeenCalled();
  });

  it("shows no favourite and toggles nothing before the user has loaded", async () => {
    stubs.user = undefined;
    const hook = await renderHook(usePhotoActions, { photoDetail: { ...photo, rating: 5 }, isPublic: false });
    expect(hook.current().isFavorite).toBe(false);
    act(() => hook.current().toggleFavorite());
    expect(stubs.favorite).not.toHaveBeenCalled();
  });
});

type RotationArgs = { hash: string | undefined; resetKey: string | undefined };
const useRotation = ({ hash, resetKey }: RotationArgs) => usePhotoRotation(hash, resetKey);

describe("usePhotoRotation", () => {
  it("turns at once, asks the server for the same turn, and snaps back once the new image is in", async () => {
    const hook = await renderHook(useRotation, { hash: "h1", resetKey: "h1" });
    act(() => hook.current().rotate(90));
    expect(hook.current().rotationAngle).toBe(90);
    const [variables, options] = defined(stubs.rotate.mock.calls[0]);
    expect(variables).toEqual({ image_hash: "h1", clockwiseDegrees: 90 });

    act(() => options.onSuccess?.());
    expect(hook.current().imageCacheKey).toBeGreaterThan(0);
    act(() => hook.current().onImageLoad());
    expect(hook.current().rotationAngle).toBe(0);
    expect(hook.current().suppressRotationTransition).toBe(true);
    // An image that loads without a rotation pending changes nothing.
    act(() => hook.current().onImageLoad());
    expect(hook.current().rotationAngle).toBe(0);
  });

  it("turns back when the server refuses, and does nothing without a photo", async () => {
    const hook = await renderHook(useRotation, { hash: "h1", resetKey: "h1" });
    act(() => hook.current().rotate(-90));
    act(() => defined(stubs.rotate.mock.calls[0])[1].onError?.());
    expect(hook.current().rotationAngle).toBe(0);

    const none = await renderHook(useRotation, { hash: undefined, resetKey: "x" });
    act(() => none.current().rotate(90));
    expect(none.current().rotationAngle).toBe(0);
    expect(stubs.rotate).toHaveBeenCalledTimes(1);
  });

  it("starts the next photo upright", async () => {
    const hook = await renderHook(useRotation, { hash: "h1", resetKey: "h1" });
    act(() => hook.current().rotate(90));
    await hook.rerender({ hash: "h2", resetKey: "h2" });
    expect(hook.current().rotationAngle).toBe(0);
    expect(hook.current().imageCacheKey).toBe(0);
  });
});

type DrawingArgs = { hash: string | undefined; onStart?: () => void };
const useDrawing = ({ hash, onStart }: DrawingArgs) => useFaceDrawing(hash, onStart);
const box: NormalizedFaceBox = { top: 0.1, left: 0.2, bottom: 0.3, right: 0.4 };

describe("useFaceDrawing", () => {
  it("draws a box, then names whoever is in it", async () => {
    const onStart = vi.fn<() => void>();
    const hook = await renderHook(useDrawing, { hash: "h1", onStart });
    act(() => hook.current().start());
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(hook.current().isDrawing).toBe(true);
    act(() => hook.current().onDrawn(box));
    expect(hook.current().isDrawing).toBe(false);
    expect(hook.current().drawnBox).toEqual(box);
    act(() => hook.current().onPersonChosen("Anna"));
    expect(stubs.addFace).toHaveBeenCalledWith({ photo: "h1", personName: "Anna", box });
    expect(hook.current().drawnBox).toBeNull();
  });

  it("names nobody without a box, and drops a box when the photo changes or on cancel", async () => {
    const hook = await renderHook(useDrawing, { hash: "h1" });
    act(() => hook.current().onPersonChosen("Anna"));
    expect(stubs.addFace).not.toHaveBeenCalled();

    act(() => hook.current().onDrawn(box));
    await hook.rerender({ hash: "h2" });
    expect(hook.current().drawnBox).toBeNull();

    act(() => hook.current().start());
    act(() => hook.current().cancel());
    expect(hook.current().isDrawing).toBe(false);
  });
});
