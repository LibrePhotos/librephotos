/**
 * The photos shared with you under one place, thing or person (#2721, #2722): grouped per sender,
 * read only, and a 404 (nothing shared under it any more) is a "nothing here" page with a way back,
 * while any other failure offers a retry.
 */
import { ApiError } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import type { EmptyStateConfig } from "../photolist/PhotoListView";
import { SharedGroupPhotos } from "./SharedGroupPhotos";

type ListProps = {
  photoset: Array<{ location: string; items: unknown[] }>;
  isPublic?: boolean;
  selectable: boolean;
  emptyStateConfig?: EmptyStateConfig;
  error?: unknown;
};

const stubs = vi.hoisted(() => ({
  query: { data: undefined as unknown, isLoading: false, isError: false, isFetching: false, error: null as unknown },
  list: undefined as ListProps | undefined,
}));

vi.mock("@tanstack/react-router", () => ({ Link: () => null }));
vi.mock("../../api_client/photos/hooks", () => ({
  useFetchSharedGroupPhotosQuery: () => ({ ...stubs.query, refetch: () => Promise.resolve() }),
}));
vi.mock("../../api_client/user/hooks", () => {
  const result = { data: [{ id: 2, username: "alice", first_name: "Alice", last_name: "Lang" }] };
  return { useFetchUserListQuery: () => result };
});
vi.mock("../photolist/PhotoListView", () => ({
  PhotoListView: (props: ListProps) => {
    stubs.list = props;
    return null;
  },
}));

let root: ReturnType<typeof createRoot> | undefined;

beforeAll(async () => {
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

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  stubs.list = undefined;
  document.body.innerHTML = "";
});

async function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () =>
    mounted.render(
      <MantineProvider env="test">
        <SharedGroupPhotos group={{ kind: "places", title: "Lisbon" }} title="Lisbon" />
      </MantineProvider>
    )
  );
  return container;
}

describe("the photos shared with you from one place", () => {
  it("are grouped per sender, read only, under the place's title", async () => {
    stubs.query = {
      data: [{ userId: 2, photos: [{ id: "a" }, { id: "b" }] }],
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
    };
    const container = await render();

    expect(container.querySelector("h1")?.textContent).toBe("Lisbon");
    expect(stubs.list?.photoset.map(group => [group.location, group.items.length])).toEqual([["Alice Lang", 2]]);
    expect(stubs.list?.isPublic).toBe(true);
    expect(stubs.list?.selectable).toBe(false);
    expect(stubs.list?.emptyStateConfig).toBeUndefined();
  });

  it("say so when nothing is shared under it any more", async () => {
    const gone = new ApiError(404, "/photos/shared/tome/places/photos/", "Not found");
    stubs.query = { data: undefined, isLoading: false, isError: true, isFetching: false, error: gone };
    await render();

    expect(stubs.list?.emptyStateConfig?.title).toBe("Nothing shared with you here");
    expect(stubs.list?.emptyStateConfig?.actionLink).toBe("/sharing/withme/places/");
    expect(stubs.list?.error).toBeUndefined();
  });

  it("offer a retry when the request failed otherwise", async () => {
    stubs.query = { data: undefined, isLoading: false, isError: true, isFetching: false, error: new Error("offline") };
    await render();

    expect(stubs.list?.emptyStateConfig).toBeUndefined();
    expect(stubs.list?.error).toBeDefined();
  });
});
