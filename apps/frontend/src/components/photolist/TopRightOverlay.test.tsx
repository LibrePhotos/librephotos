/**
 * The favourite star on a grid tile is the same filled star as in the lightbox:
 * it shows at or above the owner's favourite threshold and nothing below it.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PigPhoto } from "../../api_client/photos/types";
import { FAVORITE_COLOR, ICON_SIZE } from "../../uiConstants";
import { TopRightOverlay } from "./TopRightOverlay";

const stubs = vi.hoisted(() => ({ favoriteMinRating: 4 as number | undefined }));

vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { favorite_min_rating: stubs.favoriteMinRating } }),
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  stubs.favoriteMinRating = 4;
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
  const html = container.innerHTML;
  await act(async () => root.unmount());
  return { star, html };
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

  it("falls back to a threshold of 4 until the user's settings load", async () => {
    stubs.favoriteMinRating = undefined;
    expect((await render(4)).star).not.toBeNull();
    expect((await render(3)).star).toBeNull();
  });
});
