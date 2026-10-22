/**
 * Sharing a whole library (#2731), the owner's side: the "Your library" section lists who has my
 * library with what they see; "Share my library" shares it with every switch off unless turned on;
 * "What Ben sees" saves each switch at once, previews a photo as Ben and stops sharing after a
 * confirmation.
 */
import type { LibraryShare, Photo } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  useCreateLibraryShareMutation,
  useDeleteLibraryShareMutation,
  useUpdateLibraryShareMutation,
} from "../../api_client/libraryShares/hooks";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { YourLibrarySection } from "./YourLibrarySection";

type Create = ReturnType<typeof useCreateLibraryShareMutation>["mutate"];
type Update = ReturnType<typeof useUpdateLibraryShareMutation>["mutate"];
type Remove = ReturnType<typeof useDeleteLibraryShareMutation>["mutate"];

const ME = { id: 1, username: "anna", first_name: "Anna", last_name: "Berger" };
const BEN = { id: 2, username: "ben", first_name: "Ben", last_name: "Okafor" };
const CLARA = { id: 3, username: "clara", first_name: "Clara", last_name: "Ruiz" };

function share(overrides: Partial<LibraryShare> = {}): LibraryShare {
  return {
    id: 7,
    owner: ME,
    recipient: BEN,
    show_in_timeline: false,
    share_location: false,
    share_faces: true,
    share_camera_info: false,
    share_captions: false,
    share_originals: false,
    created_at: "2026-10-03T10:00:00Z",
    photo_count: 12,
    ...overrides,
  };
}

const stubs = vi.hoisted(() => ({
  shares: [] as LibraryShare[],
  create: vi.fn<Create>(),
  update: vi.fn<Update>(),
  remove: vi.fn<Remove>(),
  photo: undefined as Partial<Photo> | undefined,
}));

vi.mock("../../api_client/libraryShares/hooks", () => ({
  useLibrarySharesQuery: () => ({
    data: stubs.shares,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: () => Promise.resolve(),
  }),
  useCreateLibraryShareMutation: () => ({ mutate: stubs.create, isPending: false }),
  useUpdateLibraryShareMutation: () => ({ mutate: stubs.update, isPending: false }),
  useDeleteLibraryShareMutation: () => ({ mutate: stubs.remove, isPending: false }),
}));
vi.mock("../../api_client/user/hooks", () => ({
  useFetchUserListQuery: () => ({ data: [ME, BEN, CLARA] }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { id: 1 } }),
}));
vi.mock("../../api_client/photos/hooks", () => ({
  useFetchRecentlyAddedPhotosQuery: () => ({
    data: { date: null, results: stubs.photo ? [{ id: "p1", type: "image" }] : [] },
    isLoading: false,
  }),
  useFetchPhotoDetailsQuery: () => ({ data: stubs.photo, isLoading: false }),
}));
vi.mock("../Tile", () => ({ Tile: () => null }));

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
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  stubs.shares = [];
  stubs.photo = undefined;
  stubs.create.mockReset();
  stubs.update.mockReset();
  stubs.remove.mockReset();
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
        <YourLibrarySection />
      </MantineProvider>
    )
  );
}

function button(name: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === name);
  return defined(found);
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function switchNamed(label: string): HTMLInputElement {
  return defined(document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`));
}

describe("Your library", () => {
  it("invites to share when nobody has the library", async () => {
    await render();
    expect(document.body.textContent).toContain("Let family see all your photos, read-only.");
    expect(button("Share my library")).toBeTruthy();
  });

  it("lists each recipient with what they see, in words", async () => {
    stubs.shares = [share(), share({ id: 8, owner: BEN, recipient: ME })];
    await render();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Shared read-only with 1 user.");
    expect(text).toContain("Ben Okafor");
    expect(text).toContain("No location");
    expect(text).toContain("People");
    expect(text).toContain("Copies only");
    expect(text).toContain("keeps it separate");
  });

  it("saves a switch at once and stops sharing after asking", async () => {
    stubs.shares = [share({ show_in_timeline: true })];
    await render();
    expect(document.body.textContent).toContain("shows it in their timeline");
    await click(button("What Ben sees"));
    await click(switchNamed("Location"));
    expect(stubs.update).toHaveBeenCalledWith({ shareId: 7, patch: { share_location: true } });

    await click(button("Stop sharing"));
    expect(document.body.textContent).toContain("Stop sharing with Ben?");
    const confirm = Array.from(document.querySelectorAll("button")).filter(
      b => b.textContent?.trim() === "Stop sharing"
    );
    await click(defined(confirm[confirm.length - 1]));
    expect(stubs.remove.mock.calls[0]?.[0]).toEqual({ shareId: 7, side: "owner", name: "Ben Okafor" });
  });

  it("previews my newest photo as the recipient sees it", async () => {
    stubs.shares = [share()];
    stubs.photo = {
      search_location: "Starnberg",
      camera: "Pixel 8",
      exif_timestamp: "2026-10-18T14:22:00Z",
      people: [
        {
          name: "Clara",
          type: "user",
          probability: 1,
          location: { top: 0, bottom: 0, left: 0, right: 0 },
          face_url: "",
          face_id: 1,
        },
      ],
      image_path: ["/photos/IMG_0001.jpg"],
      rating: 4,
      captions_json: { user_caption: "Birthday" },
    };
    await render();
    await click(button("What Ben sees"));
    await click(button("Preview a photo as Ben"));
    const rows = Array.from(document.querySelectorAll("tbody tr")).map(row =>
      Array.from(row.children).map(cell => cell.textContent?.trim())
    );
    expect(rows).toContainEqual(["Location", "Starnberg", "Hidden"]);
    expect(rows).toContainEqual(["People names", "Clara", "Clara"]);
    expect(rows).toContainEqual(["File name", "IMG_0001.jpg", "Hidden"]);
  });

  it("asks who to share with before sharing, then shares with every switch off but the ones turned on", async () => {
    await render();
    await click(button("Share my library"));
    await click(button("Share"));
    expect(document.body.textContent).toContain("Choose who to share your library with");
    expect(stubs.create).not.toHaveBeenCalled();

    const select = defined(document.querySelector<HTMLInputElement>('input[placeholder="Search users"]'));
    await click(select);
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(o =>
      o.textContent?.includes("Clara Ruiz")
    );
    await click(defined(option));
    await click(switchNamed("Camera information"));
    await click(button("Share with Clara Ruiz"));
    expect(stubs.create.mock.calls[0]?.[0]).toEqual({
      recipientId: 3,
      recipientName: "Clara Ruiz",
      switches: {
        share_location: false,
        share_faces: false,
        share_camera_info: true,
        share_captions: false,
        share_originals: false,
      },
    });
  });
});
