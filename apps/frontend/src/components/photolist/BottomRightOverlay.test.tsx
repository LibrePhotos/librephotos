/** A tile's bottom-right corner: whose photo it is (#2731), and where a person appears in a video (#2762). */
import { PigPhoto, type User } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { BottomRightOverlay } from "./BottomRightOverlay";

type StubUser = Pick<User, "favorite_min_rating" | "rating_mode"> & { id?: number };

const stubs = vi.hoisted(() => ({ user: undefined as StubUser | undefined }));

vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.user }),
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe("BottomRightOverlay person moment (#2762)", () => {
  async function renderMoment(personVideoTime: number | null) {
    const item = PigPhoto.parse({
      id: "00000000-0000-4000-8000-000000000003",
      image_hash: "hash-3",
      aspectRatio: 1,
      person_video_time: personVideoTime,
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<BottomRightOverlay item={item} />));
    const moment = container.querySelector('[title="phototile.personvideotime"]');
    await act(async () => root.unmount());
    return moment;
  }

  it("shows in a person's photos where in the video the person is", async () => {
    expect(defined(await renderMoment(42.5)).textContent).toBe("0:42");
  });

  it("shows no moment elsewhere", async () => {
    expect(await renderMoment(null)).toBeNull();
  });
});

describe("BottomRightOverlay owner mark (#2731)", () => {
  async function renderOwned(ownerId: number) {
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    stubs.user = { favorite_min_rating: 4, rating_mode: "favorite", id: 1 };
    const item = PigPhoto.parse({
      id: "00000000-0000-4000-8000-000000000002",
      image_hash: "hash-2",
      aspectRatio: 1,
      rating: 0,
      owner: { id: ownerId, username: "anna", first_name: "Anna", last_name: "Berger" },
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <MantineProvider env="test">
          <BottomRightOverlay item={item} />
        </MantineProvider>
      )
    );
    const label = container.querySelector('[role="img"]')?.getAttribute("aria-label") ?? null;
    await act(async () => root.unmount());
    return label;
  }

  it("names the owner of another user's photo", async () => {
    // i18n is not set up in this file: the label is its key.
    expect(await renderOwned(2)).toBe("librarySharing.photoOf");
  });

  it("marks nothing on my own photo", async () => {
    expect(await renderOwned(1)).toBeNull();
  });
});
