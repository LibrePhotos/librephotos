/**
 * Reviewing photos in the lightbox and deleting the ones not needed threw the user out of it: after
 * each delete the grid behind rebuilt its list with placeholders, refilled one day at a time, and
 * the lightbox stepped through that list. On the next delete it found no neighbours and closed, or
 * it stepped back, to the top of the timeline, or onto a placeholder.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { Lightbox } from "./Lightbox";
import type { ContentViewerProps, LightboxItem } from "./lightbox.types";

const viewer = vi.fn<(props: ContentViewerProps) => void>();

vi.mock("./ContentViewer", () => ({
  ContentViewer: (props: ContentViewerProps) => {
    viewer(props);
    return null;
  },
}));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ userId: 1, isAuthenticated: true }) }));
vi.mock("../../api_client/photos/hooks", () => ({ useFetchPhotoDetailsQuery: () => ({ data: undefined }) }));
vi.mock("@tanstack/react-router", () => ({ useBlocker: () => ({ status: "idle" }) }));

beforeAll(() => {
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
});

const photo = (id: string): LightboxItem => ({ id, image_hash: `h${id}` });
const placeholder = (i: number): LightboxItem => ({ id: String(i), image_hash: "", isTemp: true });
/** The grid's list right after a refetch: every day back to placeholders. */
const refilling = (length: number) => Array.from({ length }, (_, i) => placeholder(i));

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  viewer.mockClear();
});

/** The lightbox over `list` at `selected`, as PhotoListDialogs renders it; the address follows its steps. */
async function lightbox(list: LightboxItem[], selected: string) {
  const onImageChange = vi.fn<(id: string) => void>();
  const onCloseRequest = vi.fn<() => void>();
  const container = document.createElement("div");
  const mounted = createRoot(container);
  root = mounted;
  let address = selected;
  let current = list;
  const render = async () =>
    act(async () => {
      mounted.render(
        <MantineProvider>
          <Lightbox
            idx2hash={current}
            selectedImage={address}
            isPublic={false}
            onCloseRequest={onCloseRequest}
            onChangedIndex={() => {}}
            onImageChange={id => {
              onImageChange(id);
              address = id;
            }}
          />
        </MantineProvider>
      );
    });
  await render();
  return {
    onImageChange,
    onCloseRequest,
    props: () => defined(viewer.mock.calls.at(-1))[0],
    /** The grid's list changes (a refetch, a day page loading). */
    async setList(next: LightboxItem[]) {
      current = next;
      await render();
    },
    /** A delete of `id` succeeded; true when the lightbox stays open. */
    async trashed(id: string) {
      let keepOpen = false;
      await act(async () => {
        keepOpen = defined(this.props().onTrashToggled)(id);
      });
      await render();
      return keepOpen;
    },
  };
}

describe("Lightbox deleting photos one after another", () => {
  const library = ["a", "b", "c", "d", "e"].map(photo);

  it("steps to the next photo after each delete while the grid refills", async () => {
    const view = await lightbox(library, "b");

    expect(await view.trashed("b")).toBe(true);
    expect(view.props().mainSrc).toBe("c");
    await view.setList(refilling(4));

    expect(view.props().prevSrc).toBe("a");
    expect(view.props().nextSrc).toBe("d");
    expect(await view.trashed("c")).toBe(true);
    expect(view.props().mainSrc).toBe("d");
    expect(await view.trashed("d")).toBe(true);
    expect(view.props().mainSrc).toBe("e");
    expect(view.onImageChange.mock.calls.map(([id]) => id)).toEqual(["c", "d", "e"]);
  });

  it("steps back at the end of the list, and closes only when nothing is left", async () => {
    const view = await lightbox([photo("a"), photo("b")], "b");

    expect(await view.trashed("b")).toBe(true);
    expect(view.props().mainSrc).toBe("a");
    expect(await view.trashed("a")).toBe(false);
  });

  it("takes the grid's list back once it holds the photo and its neighbours again", async () => {
    const view = await lightbox(library, "b");
    await view.trashed("b");
    await view.setList(refilling(4));

    await view.setList([photo("a"), photo("c"), photo("x"), photo("d")]);

    expect(view.props().nextSrc).toBe("x");
  });

  it("stays where the user moved to while the delete was on its way", async () => {
    const view = await lightbox(library, "b");
    await act(async () => view.props().onMoveNextRequest());

    expect(await view.trashed("b")).toBe(true);

    expect(view.props().mainSrc).toBe("c");
    expect(view.props().prevSrc).toBe("a");
  });

  it("never steps onto a placeholder", async () => {
    const view = await lightbox([photo("a"), photo("b"), placeholder(2)], "b");

    expect(view.props().nextSrc).toBeNull();
    await act(async () => view.props().onMoveNextRequest());

    expect(view.onImageChange).not.toHaveBeenCalled();
  });

  it("gives a photo that is not in the list no neighbours, rather than the top of the list", async () => {
    const view = await lightbox(library, "elsewhere");

    expect(view.props().prevSrc).toBeNull();
    expect(view.props().nextSrc).toBeNull();
  });
});
