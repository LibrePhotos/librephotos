/**
 * The favourite star on a grid tile is the same filled star as in the lightbox:
 * it shows at or above the owner's favourite threshold and nothing below it.
 * In stars mode (#2202) a rated tile shows its star count instead.
 */
import { PigPhoto, type User } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FAVORITE_COLOR, ICON_SIZE } from "../../uiConstants";
import { TopRightOverlay } from "./TopRightOverlay";

type StubUser = Pick<User, "favorite_min_rating" | "rating_mode"> & { id?: number };

const stubs = vi.hoisted(() => ({ user: undefined as StubUser | undefined }));

vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.user }),
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  stubs.user = { favorite_min_rating: 4, rating_mode: "favorite" };
});

async function render(rating: number) {
  const item = PigPhoto.parse({
    id: "00000000-0000-4000-8000-000000000001",
    image_hash: "hash-1",
    aspectRatio: 1,
    rating,
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<TopRightOverlay item={item} />));
  const star = container.querySelector("svg");
  const badge = container.querySelector('[role="img"]');
  const html = container.innerHTML;
  await act(async () => root.unmount());
  return { star, badge, html };
}

describe("TopRightOverlay favourite star", () => {
  it("shows the filled star in the lightbox colour and size at the threshold", async () => {
    const { star } = await render(4);
    expect(star).not.toBeNull();
    expect(star?.classList.contains("tabler-icon-star-filled")).toBe(true);
    expect(star?.getAttribute("fill")).toBe(FAVORITE_COLOR);
    expect(star?.getAttribute("width")).toBe(String(ICON_SIZE.overlay));
  });

  it("shows the star above the threshold", async () => {
    const { star } = await render(5);
    expect(star?.classList.contains("tabler-icon-star-filled")).toBe(true);
  });

  it("shows nothing below the threshold", async () => {
    const { star, html } = await render(3);
    expect(star).toBeNull();
    expect(html).toBe("");
  });

  it("shows nothing until the user's settings load, rather than guess a threshold", async () => {
    stubs.user = undefined;
    expect((await render(5)).html).toBe("");
  });
});

describe("TopRightOverlay in stars mode", () => {
  beforeEach(() => {
    stubs.user = { favorite_min_rating: 4, rating_mode: "stars" };
  });

  it("shows the star count of a rated photo, below the favourite threshold too", async () => {
    const { star, badge } = await render(2);
    expect(star).toBeNull();
    expect(badge?.textContent).toBe("2 ★");
    expect(badge?.getAttribute("aria-label")).toBe("phototile.rating");
  });

  it("shows nothing for an unrated photo", async () => {
    expect((await render(0)).html).toBe("");
  });
});

describe("TopRightOverlay archive mark (#545)", () => {
  async function renderItem(archived: boolean) {
    const item = PigPhoto.parse({
      id: "00000000-0000-4000-8000-000000000002",
      image_hash: "hash-2",
      aspectRatio: 1,
      rating: 0,
      archived,
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<TopRightOverlay item={item} />));
    const mark = container.querySelector('[role="img"]');
    await act(async () => root.unmount());
    return mark;
  }

  it("marks an archived tile, named for screen readers", async () => {
    const mark = await renderItem(true);
    expect(mark?.getAttribute("aria-label")).toBe("phototile.archived");
  });

  it("leaves other tiles alone", async () => {
    expect(await renderItem(false)).toBeNull();
  });
});

describe("TopRightOverlay owner mark (#2731)", () => {
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
          <TopRightOverlay item={item} />
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
