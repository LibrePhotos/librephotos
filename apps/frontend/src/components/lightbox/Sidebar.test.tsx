/**
 * Which sections the lightbox sidebar shows to whom. A viewer who is not the
 * owner (a shared album's recipient, a public page's visitor) gets no photo
 * details: the panel used to say only that details are for the owner, while the
 * grid behind it showed the photo's date and place. A public album page shows
 * what the album shares. The owner gets one Tags section (#2230).
 */
import type { Photo, PublicPhotoDetailResponse } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import { DateTime } from "luxon";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import type { LightboxItem } from "./lightbox.types";
import { makePhoto } from "./photoFixture.test-utils";
import { Sidebar } from "./Sidebar";

const stubs = vi.hoisted(() => ({
  ownPhoto: undefined as Photo | undefined,
  tagsSections: [] as string[],
  publicAlbumPhoto: undefined as PublicPhotoDetailResponse | undefined,
  people: [] as string[],
}));

vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoDetailsQuery: () => ({ data: stubs.ownPhoto, isError: false }),
  useFetchPublicPhotoDetailQuery: () => ({ data: stubs.publicAlbumPhoto, isLoading: false }),
  useUpdatePhotoMutation: () => ({ mutate: () => {} }),
}));
// Signed in: a recipient's panel asks for the photo's people and things (#2721, #2722).
vi.mock("../../api_client/auth", () => ({ useIsAuthenticatedQuery: () => ({ data: true }) }));
vi.mock("../../api_client/settings/hooks", () => ({
  useGetSettingsQuery: () => ({ data: { trash_retention_days: 30 } }),
}));
vi.mock("../../api_client/faces", () => ({ useSetFacesPersonLabelMutation: () => ({ mutate: () => {} }) }));
vi.mock("../LocationMap", () => ({ LocationMap: () => null }));
vi.mock("../modals/ModalPersonEdit", () => ({ ModalPersonEdit: () => null }));
// The owner's sections have hooks of their own; only which sections render matters here.
vi.mock("./VersionComponent", () => ({ VersionComponent: () => null }));
vi.mock("./CameraInfoSection", () => ({ CameraInfoSection: () => null }));
vi.mock("./CategoryBadge", () => ({ CategoryBadge: () => null }));
// WhyThisDate.test.tsx covers it; it reads the signed-in user.
vi.mock("./WhyThisDate", () => ({ WhyThisDate: () => null }));
vi.mock("./StackSection", () => ({ StackSection: () => null }));
vi.mock("./PeopleSection", () => ({
  PeopleSection: ({ photoDetail }: { photoDetail: { people: Array<{ name: string }> } }) => {
    stubs.people.push(...photoDetail.people.map(person => person.name));
    return null;
  },
}));
vi.mock("./Description", () => ({ Description: () => null }));
vi.mock("./AlbumsSection", () => ({ AlbumsSection: () => null }));
vi.mock("./SimilarPhotosSection", () => ({ SimilarPhotosSection: () => null }));
vi.mock("./TagsSection", () => ({
  TagsSection: ({ photoDetail }: { photoDetail: Photo }) => {
    stubs.tagsSections.push(photoDetail.id);
    return null;
  },
}));

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

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await defined(mounted.pop())();
  stubs.ownPhoto = undefined;
  stubs.tagsSections = [];
  stubs.publicAlbumPhoto = undefined;
  stubs.people = [];
});

async function renderSidebar(gridItem?: LightboxItem, isPublic = true, publicAlbumSlug?: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <Sidebar
          id="h1"
          isPublic={isPublic}
          publicAlbumSlug={publicAlbumSlug}
          gridItem={gridItem}
          closeSidepanel={() => {}}
          setFaceLocation={() => {}}
        />
      </MantineProvider>
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

describe("Sidebar for a viewer who is not the owner", () => {
  it("shows the date and place the grid already shows, read-only", async () => {
    const container = await renderSidebar({
      id: "p1",
      image_hash: "h1",
      date: "2023-05-06T04:57:00+00:00",
      location: "Berlin, Germany",
    });

    expect(container.textContent).toContain("May 6, 2023");
    expect(container.textContent).toContain("Berlin, Germany");
    expect(container.textContent).toContain(i18n.t("lightbox.sidebar.ownerOnlyMoreDetails"));
    // Neither can be edited by this viewer.
    expect(container.querySelector(`[aria-label="${i18n.t("lightbox.sidebar.editdatetime")}"]`)).toBeNull();
    expect(container.querySelector(`[aria-label="${i18n.t("lightbox.sidebar.update_location")}"]`)).toBeNull();
  });

  it("says only that details are for the owner when the grid has neither", async () => {
    // A photo with no timestamp and no location, on a user's public page or in
    // a shared album (public album links take the slug branch instead).
    const container = await renderSidebar({ id: "p1", image_hash: "h1", date: "", location: "" });

    expect(container.textContent).not.toContain(i18n.t("lightbox.sidebar.withouttimestamp"));
    expect(container.textContent).not.toContain(i18n.t("lightbox.sidebar.no_location"));
    expect(container.textContent).toContain(i18n.t("lightbox.sidebar.ownerOnlyDetails"));
  });
});

describe("Sidebar for a user the photo is shared with (#2721, #2722)", () => {
  it("shows the people and things the server gives them, and whose photo it is", async () => {
    stubs.ownPhoto = makePhoto({
      id: "p1",
      image_hash: "h1",
      owner: { id: 2, username: "alice", first_name: "Alice", last_name: "Lang" },
      captions_json: { openclip_vitb32: { tags: ["tram", "sunset"] } },
      people: [
        {
          name: "Mom",
          type: "user",
          probability: 1,
          location: { top: 0, bottom: 1, left: 0, right: 1 },
          face_url: "",
          face_id: 3,
        },
      ],
    });
    const container = await renderSidebar({ id: "p1", image_hash: "h1", date: "", location: "Lisbon" });

    expect(stubs.people).toEqual(["Mom"]);
    expect(container.textContent).toContain("tram");
    expect(container.textContent).toContain("Shared by Alice Lang");
    // Read only: the things are labels, not search buttons.
    expect(container.querySelector("button.mantine-Badge-root")).toBeNull();
  });
});

describe("Sidebar for the owner", () => {
  it("lists tags in one section, with no separate keywords editor (#2230)", async () => {
    stubs.ownPhoto = makePhoto({ id: "p1", image_hash: "h1" });

    const container = await renderSidebar(undefined, false);

    expect(stubs.tagsSections).toEqual(["p1"]);
    expect(container.textContent).not.toMatch(/keyword/i);
    expect(container.textContent).not.toContain("Moved to the trash");
  });

  it("says when a trashed photo was trashed and when it is deleted for good (#2203)", async () => {
    const trashedAt = DateTime.now().minus({ days: 10, hours: 1 }).toISO();
    stubs.ownPhoto = makePhoto({ id: "p1", image_hash: "h1", in_trashcan: true, trashed_at: trashedAt });

    const container = await renderSidebar(undefined, false);

    expect(container.textContent).toContain("Moved to the trash on");
    expect(container.textContent).toContain("Deleted for good in 20 days");
  });

  it("gives the owner the coordinates and the altitude under the place name (#2276)", async () => {
    stubs.ownPhoto = makePhoto({
      id: "p1",
      image_hash: "h1",
      exif_gps_lat: 37.0899,
      exif_gps_lon: -8.4128,
      search_location: "Praia da Marinha",
      gps_altitude: 31,
    });

    const container = await renderSidebar(undefined, false);

    expect(container.textContent).toContain("Praia da Marinha");
    expect(container.textContent).toContain("37.08990, -8.41280");
    expect(container.textContent).toContain("31 m above sea level");
  });
});

const sharing = (shared: Partial<PublicPhotoDetailResponse["sharing_settings"]>) => ({
  share_location: false,
  share_camera_info: false,
  share_timestamps: false,
  share_captions: false,
  share_faces: false,
  ...shared,
});

const publicPhoto: PublicPhotoDetailResponse["results"] = {
  image_hash: "h1",
  video: false,
  square_thumbnail_url: "",
  big_thumbnail_url: "",
  small_square_thumbnail_url: "",
  exif_timestamp: "2023-05-06T04:57:00+00:00",
  search_location: "Berlin, Germany",
  people: [{ name: "Ada", face_url: null, face_id: 7 }],
};

describe("Sidebar on a public album page", () => {
  it("shows what the album shares", async () => {
    stubs.publicAlbumPhoto = {
      results: publicPhoto,
      sharing_settings: sharing({ share_timestamps: true, share_location: true, share_faces: true }),
    };

    const container = await renderSidebar(undefined, true, "slug");

    expect(container.textContent).toContain("May 6, 2023");
    expect(container.textContent).toContain("Berlin, Germany");
    expect(stubs.people).toEqual(["Ada"]);
    expect(container.textContent).not.toContain(i18n.t("lightbox.sidebar.noAdditionalDetails"));
  });

  it("gives a visitor no coordinates under the place name (#2276)", async () => {
    stubs.publicAlbumPhoto = {
      results: { ...publicPhoto, exif_gps_lat: 52.52, exif_gps_lon: 13.4 },
      sharing_settings: sharing({ share_location: true, share_camera_info: true }),
    };

    const container = await renderSidebar(undefined, true, "slug");

    expect(container.textContent).toContain("Berlin, Germany");
    expect(container.textContent).not.toContain("52.52000");
    expect(container.querySelector(`[aria-label="${i18n.t("exif.copycoordinates")}"]`)).toBeNull();
  });

  it("says there is nothing more when the album shares no details", async () => {
    stubs.publicAlbumPhoto = { results: publicPhoto, sharing_settings: sharing({}) };

    const container = await renderSidebar(undefined, true, "slug");

    expect(container.textContent).not.toContain("Berlin, Germany");
    expect(container.textContent).toContain(i18n.t("lightbox.sidebar.noAdditionalDetails"));
  });

  it("says so when the photo could not be loaded", async () => {
    const container = await renderSidebar(undefined, true, "slug");

    expect(container.textContent).toContain(i18n.t("lightbox.sidebar.detailsLoadFailed"));
  });
});
