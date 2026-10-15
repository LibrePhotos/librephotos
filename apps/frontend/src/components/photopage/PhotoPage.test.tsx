/**
 * The photo page: what it says when there is no photo, what the owner gets
 * (actions and editors) against a viewer it is shared with (the lightbox's
 * shared variant), and the viewer, Back and trash wiring around the photo.
 */
import type { Photo } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import type { Lightbox } from "../lightbox/Lightbox";
import type { MediaDisplayProps } from "../lightbox/MediaDisplay";
import { makePhoto } from "../lightbox/photoFixture.test-utils";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import type { OwnerPhotoDetails } from "./OwnerPhotoDetails";
import type { PhotoActionTiles } from "./PhotoActionTiles";
import { PhotoPage } from "./PhotoPage";

type Stubs = {
  query: { data: Photo | undefined; isError: boolean };
  userId: number | null;
  canGoBack: boolean;
  media: MediaDisplayProps[];
  lightbox: React.ComponentProps<typeof Lightbox>[];
  owner: React.ComponentProps<typeof OwnerPhotoDetails>[];
  tiles: React.ComponentProps<typeof PhotoActionTiles>[];
};

const stubs = vi.hoisted(() => {
  const state: Stubs = {
    query: { data: undefined, isError: false },
    userId: 1,
    canGoBack: true,
    media: [],
    lightbox: [],
    owner: [],
    tiles: [],
  };
  return Object.assign(state, {
    back: vi.fn<() => void>(),
    navigate: vi.fn<(options: { to: string }) => Promise<void>>(async () => {}),
    markDeleted: vi.fn<(variables: { image_hashes: string[]; deleted: boolean }) => void>(),
    setHidden: vi.fn<(variables: { image_hashes: string[]; hidden: boolean }) => void>(),
    setArchived: vi.fn<(variables: { image_hashes: string[]; archived: boolean }) => void>(),
  });
});

function last<Props>(rendered: Props[]): Props {
  const props = rendered.at(-1);
  if (!props) throw new Error("the page did not render it");
  return props;
}

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
  // Leaving with an unsaved edit (#2284): PhotoPageDraftsGuard.test.tsx covers it.
  useBlocker: () => ({ status: "idle" }),
  useCanGoBack: () => stubs.canGoBack,
  useNavigate: () => stubs.navigate,
  useRouter: () => ({ history: { back: stubs.back } }),
}));
vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoDetailsQuery: () => stubs.query,
  useFetchPhotoSharesQuery: () => ({ data: [] }),
  useMarkPhotosDeletedMutation: () => ({ mutate: stubs.markDeleted }),
  useSetFavoritePhotosMutation: () => ({ mutate: () => {} }),
  useSetPhotosHiddenMutation: () => ({ mutate: stubs.setHidden }),
  useSetPhotosArchivedMutation: () => ({ mutate: stubs.setArchived }),
  useSetPhotosRatingMutation: () => ({ mutate: () => {}, isPending: false }),
  useUpdatePhotoMutation: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("../../api_client/photos/hooks/useRotatePhotosMutation", () => ({
  useRotatePhotosMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: { favorite_min_rating: 4 } }),
}));
vi.mock("../../api_client/settings/hooks", () => ({
  useGetSettingsQuery: () => ({ data: { trash_retention_days: 30 } }),
}));
vi.mock("../../api_client/faces", () => ({ useAddFaceMutation: () => ({ mutate: () => {} }) }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, userId: stubs.userId }) }));
vi.mock("../../hooks/useCopyPhotoToClipboard", () => ({
  useCopyPhotoToClipboard: () => ({ supported: true, isCopying: false, copy: () => {} }),
}));
vi.mock("../lightbox/MediaDisplay", () => ({
  MediaDisplay: (props: MediaDisplayProps) => {
    stubs.media.push(props);
    return null;
  },
}));
vi.mock("../lightbox/Lightbox", () => ({
  Lightbox: (props: React.ComponentProps<typeof Lightbox>) => {
    stubs.lightbox.push(props);
    return <div data-viewer="" />;
  },
}));
vi.mock("./OwnerPhotoDetails", () => ({
  OwnerPhotoDetails: (props: React.ComponentProps<typeof OwnerPhotoDetails>) => {
    stubs.owner.push(props);
    return null;
  },
}));
vi.mock("./PhotoActionTiles", () => ({
  PhotoActionTiles: (props: React.ComponentProps<typeof PhotoActionTiles>) => {
    stubs.tiles.push(props);
    return null;
  },
}));
vi.mock("../modals/ModalPersonEdit", () => ({ ModalPersonEdit: () => null }));

beforeAll(setUpMantineDom);

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await defined(mounted.pop())();
  stubs.query = { data: undefined, isError: false };
  stubs.userId = 1;
  stubs.canGoBack = true;
  stubs.media.length = 0;
  stubs.lightbox.length = 0;
  stubs.owner.length = 0;
  stubs.tiles.length = 0;
  stubs.back.mockClear();
  stubs.navigate.mockClear();
  stubs.markDeleted.mockClear();
  stubs.setHidden.mockClear();
  stubs.setArchived.mockClear();
});

async function renderPage(photoId = "abc") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <PhotoPage photoId={photoId} />
      </MantineProvider>
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

function button(container: HTMLElement, name: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>("button")].find(
    el => el.textContent?.trim() === name || el.getAttribute("aria-label") === name
  );
  if (!found) throw new Error(`no button "${name}"`);
  return found;
}

const photo = makePhoto({
  id: "p1",
  image_hash: "abc",
  image_path: ["/photos/2024/IMG_0001.jpg"],
  exif_timestamp: "2024-08-17T20:41:00Z",
  search_location: "Praia da Marinha, Lagoa, Portugal",
  exif_gps_lat: 37.0899,
  exif_gps_lon: -8.4128,
  width: 4000,
  height: 3000,
});

describe("photo page", () => {
  it("says there is no photo id", async () => {
    const container = await renderPage("");
    expect(container.textContent).toContain("photopage.noid");
  });

  it("says the photo cannot be found instead of loading forever", async () => {
    stubs.query = { data: undefined, isError: true };
    const container = await renderPage();
    expect(container.textContent).toContain("photopage.notfound");
    expect(container.textContent).not.toContain("photopage.loading");
  });

  it("shows the loader while the details load", async () => {
    const container = await renderPage();
    expect(container.textContent).toContain("photopage.loading");
  });

  it("titles the page with the date, and puts the time and place under it", async () => {
    stubs.query = { data: photo, isError: false };
    const container = await renderPage();
    const title = defined(container.querySelector("h1"));
    expect(title.textContent).toContain("2024");
    expect(container.textContent).toContain("Praia da Marinha, Lagoa, Portugal");
    // The file name moved to the File card; it is not the title any more.
    expect(title.textContent).not.toContain("IMG_0001.jpg");
  });

  it("hands a video's details to the player, which decides whether to convert from them", async () => {
    const video = makePhoto({ ...photo, video: true, video_playback_type: 'video/mp4; codecs="hvc1"' });
    stubs.query = { data: video, isError: false };
    await renderPage();
    expect(last(stubs.media).type).toBe("video");
    expect(last(stubs.media).photoDetails).toBe(video);
    expect(last(stubs.media).fullHeight).toBe(true);
  });

  it("gives the owner the actions and the editors", async () => {
    stubs.query = { data: photo, isError: false };
    const container = await renderPage();
    expect(last(stubs.tiles).photo).toBe(photo);
    // A still photo turns; the server does not turn a video.
    expect(last(stubs.tiles).onRotate).toBeDefined();
    expect(last(stubs.owner).photo).toBe(photo);
    expect(last(stubs.media).isPublic).toBe(false);
    expect(container.querySelector('[aria-label="lightbox.sidebar.editdatetime"]')).not.toBeNull();
  });

  it("shows someone the photo is shared with what the lightbox shows them, nothing to edit", async () => {
    stubs.userId = 2;
    stubs.query = { data: { ...photo, search_location: null }, isError: false };
    const container = await renderPage();
    expect(stubs.tiles).toHaveLength(0);
    expect(stubs.owner).toHaveLength(0);
    expect(last(stubs.media).isPublic).toBe(true);
    expect(container.textContent).toContain("photopage.sharedby");
    expect(container.querySelector('[aria-label="lightbox.sidebar.editdatetime"]')).toBeNull();
    // A place without a name is not named by its coordinates for them.
    expect(container.textContent).not.toContain("37.08990");
  });

  it("names a place the geocoder could not name by its coordinates, for the owner", async () => {
    stubs.query = { data: { ...photo, search_location: null }, isError: false };
    const container = await renderPage();
    expect(container.textContent).toContain("37.08990, -8.41280");
  });

  it("opens the viewer on this one photo, as a shared viewer for someone else", async () => {
    stubs.userId = 2;
    stubs.query = { data: photo, isError: false };
    const container = await renderPage();
    await act(async () => button(container, "photopage.openinviewer").click());
    const viewer = last(stubs.lightbox);
    expect(viewer.isPublic).toBe(true);
    expect(viewer.selectedImage).toBe("abc");
    expect(viewer.idx2hash).toEqual([
      { id: "abc", image_hash: "abc", type: "image", date: photo.exif_timestamp, location: photo.search_location },
    ]);
    expect(container.querySelector("[data-viewer]")).not.toBeNull();
    await act(async () => viewer.onCloseRequest());
    expect(container.querySelector("[data-viewer]")).toBeNull();
  });

  it("goes back where it came from, or to the timeline from a link", async () => {
    stubs.query = { data: photo, isError: false };
    const container = await renderPage();
    await act(async () => button(container, "photopage.back").click());
    expect(stubs.back).toHaveBeenCalledTimes(1);

    stubs.canGoBack = false;
    const fromLink = await renderPage();
    await act(async () => button(fromLink, "photopage.back").click());
    expect(stubs.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("says a trashed photo is in the trash, since when and until when, and restores it from there", async () => {
    stubs.query = { data: { ...photo, in_trashcan: true, trashed_at: "2026-10-02T08:00:00Z" }, isError: false };
    const container = await renderPage();
    expect(container.textContent).toContain("photopage.status.trashed");
    // The trash retention (#2203): the keys, as this test runs without the English strings.
    expect(container.textContent).toContain("trash.trashedOn");
    expect(container.textContent).toMatch(/trash\.(deletedIn|deletedNext)/);
    await act(async () => button(container, "photopage.actions.restore").click());
    expect(defined(stubs.markDeleted.mock.calls[0])[0]).toEqual({ image_hashes: ["abc"], deleted: false });
  });

  it("lays the recognised text over the photo on request, for the owner", async () => {
    const ocr = {
      text: "EXIT",
      blocks: [
        {
          text: "EXIT",
          box: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        },
      ],
    };
    stubs.query = { data: { ...photo, ocr }, isError: false };
    const container = await renderPage();
    expect(last(stubs.media).showOcrText).toBe(false);
    await act(async () => button(container, "photopage.livetext").click());
    expect(last(stubs.media).showOcrText).toBe(true);
    expect(last(stubs.media).ocrBlocks).toBe(ocr.blocks);
    expect(button(container, "photopage.livetextoff")).toBeDefined();
  });

  it("has no live text for a video", async () => {
    const ocr = {
      text: "EXIT",
      blocks: [
        {
          text: "EXIT",
          box: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        },
      ],
    };
    stubs.query = { data: { ...photo, video: true, ocr }, isError: false };
    const container = await renderPage();
    expect(container.querySelector('[aria-label="photopage.livetext"]')).toBeNull();
    expect(last(stubs.media).ocrBlocks).toBeUndefined();
  });

  it("says a hidden photo is hidden and shows it again from there", async () => {
    stubs.query = { data: { ...photo, hidden: true }, isError: false };
    const container = await renderPage();
    expect(container.textContent).toContain("photopage.status.hidden");
    await act(async () => button(container, "photopage.actions.show").click());
    expect(stubs.setHidden).toHaveBeenCalledWith({ image_hashes: ["abc"], hidden: false });
  });

  it("says an archived photo is archived and unarchives it from there (#545)", async () => {
    stubs.query = { data: { ...photo, archived: true }, isError: false };
    const container = await renderPage();
    expect(container.textContent).toContain("photopage.status.archived");
    await act(async () => button(container, "photopage.actions.unarchive").click());
    expect(stubs.setArchived).toHaveBeenCalledWith({ image_hashes: ["abc"], archived: false });
  });

  it("names hidden, not archived, for a photo that is both", async () => {
    stubs.query = { data: { ...photo, archived: true, hidden: true }, isError: false };
    const container = await renderPage();
    expect(container.textContent).toContain("photopage.status.hidden");
    expect(container.textContent).not.toContain("photopage.status.archived");
  });
});
