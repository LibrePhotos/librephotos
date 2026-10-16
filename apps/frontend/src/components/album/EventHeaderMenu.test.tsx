/**
 * The event page's "⋮" (#429): "Set as cover…" opens the cover picker on the event's photos, with
 * the cover in use marked and an "Automatic" choice that clears the pick; "Delete event" asks
 * first and goes back to Events once the event is gone.
 */
import { Media } from "@librephotos/api-client";
import type { PigPhoto } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { QueryClient } from "@tanstack/react-query";
import type { UseNavigateResult } from "@tanstack/react-router";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { useDeleteAutoAlbumMutation, useSetEventCoverMutation } from "../../api_client/albums/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import type { AlbumCoverPickerModal } from "../modals/AlbumCoverPickerModal";
import type { AutoAlbumDeleteModal } from "./AutoAlbumDeleteModal";
import { EventHeaderMenu } from "./EventHeaderMenu";

type CoverProps = React.ComponentProps<typeof AlbumCoverPickerModal>;
type DeleteProps = React.ComponentProps<typeof AutoAlbumDeleteModal>;
type SetCover = ReturnType<typeof useSetEventCoverMutation>["mutate"];
type DeleteEvent = ReturnType<typeof useDeleteAutoAlbumMutation>["mutate"];

const stubs = vi.hoisted(() => ({
  navigate: vi.fn<UseNavigateResult<string>>(),
  setCover: vi.fn<SetCover>(),
  deleteEvent: vi.fn<DeleteEvent>(),
  cover: undefined as CoverProps | undefined,
  remove: undefined as DeleteProps | undefined,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => stubs.navigate }));
vi.mock("../../api_client/albums/hooks", () => ({
  useSetEventCoverMutation: () => ({ mutate: stubs.setCover }),
  useDeleteAutoAlbumMutation: () => ({ mutate: stubs.deleteEvent }),
}));
vi.mock("../modals/AlbumCoverPickerModal", () => ({
  AlbumCoverPickerModal: (props: CoverProps) => {
    stubs.cover = props;
    return null;
  },
}));
vi.mock("./AutoAlbumDeleteModal", () => ({
  AutoAlbumDeleteModal: (props: DeleteProps) => {
    stubs.remove = props;
    return null;
  },
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
const photos = [tile("p1"), tile("p2")];

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

let root: Root | undefined;

async function render(coverPhoto: string | null = null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    defined(root).render(
      <MantineProvider env="test">
        <EventHeaderMenu event={{ id: "12", title: "Saturday in Porto", coverPhoto }} photos={photos} />
      </MantineProvider>
    )
  );
}

beforeEach(() => {
  stubs.navigate.mockReset();
  stubs.setCover.mockReset();
  stubs.deleteEvent.mockReset();
  stubs.cover = undefined;
  stubs.remove = undefined;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
});

function button(name: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(
    el => el.getAttribute("aria-label") === name || el.textContent?.trim() === name
  );
  return defined(found, `button ${name}`);
}

async function pick(item: string) {
  await act(async () => button("Event actions").click());
  await act(async () => button(item).click());
}

describe("EventHeaderMenu", () => {
  it("offers Set as cover and Delete event", async () => {
    await render();
    await act(async () => button("Event actions").click());

    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(el => el.textContent?.trim());
    expect(items).toEqual(["Set as cover…", "Delete event"]);
  });

  it("picks the cover from the event's photos, the one in use marked", async () => {
    await render("p2");
    expect(stubs.cover?.isOpen).toBe(false);

    await pick("Set as cover…");

    const cover = defined(stubs.cover);
    expect(cover).toMatchObject({ isOpen: true, albumTitle: "Saturday in Porto", currentCoverId: "p2" });
    expect(cover.photos.map(photo => photo.id)).toEqual(["p1", "p2"]);
    act(() => cover.onSelectCover("p1"));
    expect(stubs.setCover).toHaveBeenCalledWith({ id: "12", photo: "p1" });
  });

  it("goes back to the automatic cover", async () => {
    await render("p2");
    await pick("Set as cover…");

    act(() => defined(defined(stubs.cover).onSelectAutomatic)());

    expect(stubs.setCover).toHaveBeenCalledWith({ id: "12", photo: null });
  });

  it("deletes after asking, then goes to Events", async () => {
    await render();
    await pick("Delete event");

    const remove = defined(stubs.remove);
    expect(remove).toMatchObject({ opened: true, title: "Saturday in Porto" });
    act(() => remove.onConfirm());
    const [params, options] = defined(stubs.deleteEvent.mock.calls[0]);
    expect(params).toEqual({ id: "12", albumTitle: "Saturday in Porto" });
    expect(stubs.navigate).not.toHaveBeenCalled();
    act(() => options?.onSuccess?.(undefined, params, undefined, { client: new QueryClient(), meta: undefined }));
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/album/events" });
  });

  it("hands focus back to the menu button when the picker closes", async () => {
    await render();
    await pick("Set as cover…");

    act(() => defined(stubs.cover).onRequestClose());

    expect(stubs.cover?.isOpen).toBe(false);
    expect(document.activeElement).toBe(button("Event actions"));
  });
});
