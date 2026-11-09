/**
 * The favourite star on a grid tile (bottom-left, review r6 #10) is the same filled star as in the lightbox:
 * it shows at or above the owner's favourite threshold and nothing below it.
 * In stars mode (#2202) a rated tile shows its star count instead.
 */
import { PigPhoto, type User } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomLeftOverlay } from "./BottomLeftOverlay";
import { TILE_GLYPH_SIZE } from "./TileBadge";

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
  await act(async () => root.render(<BottomLeftOverlay item={item} />));
  const star = container.querySelector(".tabler-icon-star-filled");
  const badge = container.querySelector('[role="img"]');
  const html = container.textContent;
  await act(async () => root.unmount());
  return { star, badge, html };
}

describe("BottomLeftOverlay favourite star", () => {
  it("shows the filled star as a white glyph in the overlay size at the threshold", async () => {
    const { star } = await render(4);
    expect(star).not.toBeNull();
    expect(star?.classList.contains("tabler-icon-star-filled")).toBe(true);
    // White like the other tile marks, not the lightbox's yellow (review r0 #16)
    expect(star?.getAttribute("fill")).toBe("white");
    expect(star?.getAttribute("width")).toBe(String(TILE_GLYPH_SIZE));
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

describe("BottomLeftOverlay in stars mode", () => {
  beforeEach(() => {
    stubs.user = { favorite_min_rating: 4, rating_mode: "stars" };
  });

  it("shows the star count of a rated photo, below the favourite threshold too", async () => {
    const { badge } = await render(2);
    // The count after a star glyph, in the same badge style as the favourite star
    expect(badge?.textContent).toBe("2");
    expect(badge?.querySelector(".tabler-icon-star-filled")).not.toBeNull();
    expect(badge?.getAttribute("aria-label")).toBe("phototile.rating");
  });

  it("shows nothing for an unrated photo", async () => {
    expect((await render(0)).html).toBe("");
  });
});

describe("BottomLeftOverlay archive mark (#545)", () => {
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
    await act(async () => root.render(<BottomLeftOverlay item={item} />));
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
