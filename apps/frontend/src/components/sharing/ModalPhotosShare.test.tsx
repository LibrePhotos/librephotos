/**
 * The photo share dialog says what the users you share with see (#2722): the date, place and
 * things, and the names of people only with the setting on. Sharing and unsharing a selection
 * still sends the selection, by hash or as select-all with its exclusions.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { useUpdatePhotoSharingMutation } from "../../api_client/photos/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { ModalPhotosShare } from "./ModalPhotosShare";

type Share = ReturnType<typeof useUpdatePhotoSharingMutation>["mutate"];

const stubs = vi.hoisted(() => ({ share: vi.fn<Share>() }));

vi.mock("../../api_client/photos/hooks", () => ({
  useUpdatePhotoSharingMutation: () => ({ mutate: stubs.share }),
}));
vi.mock("../../api_client/user/hooks", () => {
  const result = {
    data: [
      { id: 1, username: "me", first_name: "", last_name: "" },
      { id: 2, username: "alice", first_name: "Alice", last_name: "Lang", date_joined: "2026-01-01T00:00:00Z" },
      { id: 3, username: "jonas", first_name: "", last_name: "" },
    ],
    isFetching: false,
    isSuccess: true,
  };
  return { useFetchUserListQuery: () => result };
});
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { id: 1 } }),
}));
vi.mock("../common/MediaThumbnail", () => ({ MediaThumbnail: () => null }));

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
  // The dialog's ScrollArea measures its viewport; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  stubs.share.mockReset();
  document.body.innerHTML = "";
});

async function open(props: Partial<React.ComponentProps<typeof ModalPhotosShare>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () =>
    mounted.render(
      <MantineProvider env="test">
        <ModalPhotosShare selectedImageHashes={["h1", "h2"]} isOpen onRequestClose={() => {}} {...props} />
      </MantineProvider>
    )
  );
}

const button = (label: string) => defined(document.body.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`));

describe("the photo share dialog", () => {
  it("says what the users you share with see", async () => {
    await open();

    expect(document.body.textContent).toContain(
      "People you share with see each photo's date, place and things. They see the names of the people on it only if you turn on"
    );
  });

  it("lists the other users and shares the selected photos with one", async () => {
    await open();

    // Not yourself
    expect(document.body.querySelector('[aria-label="Share: me"]')).toBeNull();
    await act(async () => button("Share: Alice Lang").click());
    const [request] = defined(stubs.share.mock.calls[0]);
    expect(request).toMatchObject({ image_hashes: ["h1", "h2"], val_shared: true, target_user: { id: 2 } });

    await act(async () => button("Unshare: jonas").click());
    expect(stubs.share).toHaveBeenLastCalledWith(expect.objectContaining({ val_shared: false }));
  });

  it("shares a select-all selection with its exclusions", async () => {
    await open({ selectAllMode: true, selectAllQuery: { favorite: true }, totalCount: 10 });

    await act(async () => button("Share: jonas").click());
    expect(stubs.share).toHaveBeenCalledWith(
      expect.objectContaining({ select_all: true, query: { favorite: true }, excluded_hashes: ["h1", "h2"] })
    );
  });
});
