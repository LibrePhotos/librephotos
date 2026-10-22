/**
 * The card a spot of the Places map opens (#343): how many photos were taken there, the newest
 * few, and the way into the lightbox over all of them.
 */
import { PigPhoto } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { SpotCard } from "./SpotCard";

type Query = { data: PigPhoto[] | undefined; isError: boolean; isFetching: boolean; refetch: () => void };

const stubs = vi.hoisted((): { query: Query } => ({
  query: { data: undefined, isError: false, isFetching: false, refetch: () => {} },
}));

vi.mock("../../api_client/albums/hooks", () => ({ usePhotosInBoundsQuery: (): Query => stubs.query }));
vi.mock("../../api_client/urls", () => ({ serverAddress: "" }));

// A, B, ... as the last digit of a UUID
const photo = (letter: string): PigPhoto =>
  PigPhoto.parse({ id: `0b7a3d52-3c55-4c1f-9d7e-2b8f1e7a9c1${letter}`, image_hash: `hash-${letter}`, aspectRatio: 1 });

const SPOT = { longitude: 11.5, latitude: 48.1, bounds: { south: 48, west: 11, north: 49, east: 12 } };

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  stubs.query = { data: undefined, isError: false, isFetching: false, refetch: () => {} };
});

async function renderCard() {
  const onOpen = vi.fn<(photos: PigPhoto[], photoId: string) => void>();
  const onClose = vi.fn<() => void>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <SpotCard spot={SPOT} onOpen={onOpen} onClose={onClose} />
      </MantineProvider>
    );
  });
  const button = (name: string) =>
    Array.from(container.querySelectorAll("button")).find(
      element => element.textContent === name || element.getAttribute("aria-label") === name
    );
  return {
    container,
    onOpen,
    onClose,
    button,
    unmount: () =>
      act(async () => {
        root.unmount();
      }),
  };
}

describe("SpotCard", () => {
  it("says it is loading until the photos are there", async () => {
    const card = await renderCard();
    expect(card.container.textContent).toContain(i18n.t("loading"));
    expect(card.button("Open 1 photo")).toBeUndefined();
    await card.unmount();
  });

  it("counts the photos, shows the newest four and opens the lightbox", async () => {
    const photos = ["a", "b", "c", "d", "e"].map(photo);
    const second = photos[1]?.id;
    stubs.query = { ...stubs.query, data: photos };
    const card = await renderCard();

    expect(card.container.textContent).toContain("5 photos here");
    const thumbnails = card.container.querySelectorAll<HTMLButtonElement>(
      `button[aria-label="${i18n.t("placealbum.openPhoto")}"]`
    );
    expect(thumbnails).toHaveLength(4);

    await act(async () => {
      thumbnails.item(1).click();
    });
    expect(card.onOpen).toHaveBeenLastCalledWith(photos, second);
    await act(async () => {
      card.button("Open 5 photos")?.click();
    });
    expect(card.onOpen).toHaveBeenLastCalledWith(photos, photos[0]?.id);
    await act(async () => {
      card.button(i18n.t("close"))?.click();
    });
    expect(card.onClose).toHaveBeenCalled();
    await card.unmount();
  });

  it("says when the photos could not be read", async () => {
    stubs.query = { ...stubs.query, isError: true };
    const card = await renderCard();
    expect(card.container.textContent).toContain(i18n.t("errorstate.title"));
    await card.unmount();
  });
});
