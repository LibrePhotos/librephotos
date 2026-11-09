/**
 * The photo grid's display preferences show at once and are saved after a pause. An effect copied
 * the profile's values over them whenever those changed, so a save landing while the slider moved
 * on threw the newer value away; and a refused save left the grid at a value the server never took.
 */
import type { User } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { usePhotoListPreferences } from "./usePhotoListPreferences";

const mocks = vi.hoisted(() => ({
  save: vi.fn<(user: Partial<User>) => Promise<unknown>>(),
}));

vi.mock("../../api_client/user/hooks", () => ({
  useUpdateUserMutation: () => ({ mutateAsync: mocks.save }),
}));
vi.mock("../../api_client/user/hooks/usePhotoOrder", () => ({
  useSetPhotoOrderMutation: () => ({ mutate: vi.fn<() => void>() }),
}));

type Preferences = ReturnType<typeof usePhotoListPreferences>;
type Profile = NonNullable<Parameters<typeof usePhotoListPreferences>[0]>;

const user = (imageScale: number): Profile => ({
  id: 1,
  image_scale: imageScale,
  text_alignment: "left",
  header_size: "normal",
  scrubber_style: "thumb",
});

let root: Root;
let latest: Preferences | undefined;

function Probe({ profile }: { profile: Profile }) {
  latest = usePhotoListPreferences(profile);
  return null;
}

const render = async (profile: Profile) => act(async () => root.render(<Probe profile={profile} />));
const preferences = () => defined(latest);

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  vi.useFakeTimers();
  mocks.save.mockReset().mockResolvedValue({});
  root = createRoot(document.createElement("div"));
  await render(user(1));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe("usePhotoListPreferences", () => {
  it("saves the size after a pause", async () => {
    await act(async () => preferences().handleThumbnailSizeChange(3));
    expect(preferences().localImageScale).toBe(3);
    await act(async () => vi.advanceTimersByTime(500));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: 1, image_scale: 3 }));
  });

  it("keeps a size not saved yet when the profile changes meanwhile", async () => {
    await act(async () => preferences().handleThumbnailSizeChange(3));
    // An earlier save (or another tab) lands while this one waits for its pause.
    await render(user(2));
    expect(preferences().localImageScale).toBe(3);
  });

  it("goes back to the stored size when the save is refused", async () => {
    mocks.save.mockRejectedValue(new Error("refused"));
    await act(async () => preferences().handleThumbnailSizeChange(3));
    await act(async () => vi.advanceTimersByTime(500));
    expect(preferences().localImageScale).toBe(1);
  });
});
