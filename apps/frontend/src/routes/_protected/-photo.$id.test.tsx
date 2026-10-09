/**
 * The single-photo page (Ctrl/Cmd+click on a tile, or a similar photo's link).
 *
 * It used to spin forever on a photo it could not load, played videos without
 * the lightbox's up-front conversion check because it never passed the details
 * on, and wired its face buttons to nothing.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as
 * a route (its `routeFileIgnorePrefix`).
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Photo } from "../../api_client/photos/types";
import type { MediaDisplayProps } from "../../components/lightbox";
import type { PeopleSection } from "../../components/lightbox/PeopleSection";
import { makePhoto } from "../../components/lightbox/photoFixture.test-utils";
import type { ModalPersonEdit } from "../../components/modals/ModalPersonEdit";
import { defined } from "../../util/defined.test-utils";

type Stubs = {
  component: React.ComponentType | undefined;
  query: { data: Photo | undefined; isError: boolean };
  media: MediaDisplayProps[];
  people: React.ComponentProps<typeof PeopleSection>[];
  personEdit: React.ComponentProps<typeof ModalPersonEdit>[];
};

const stubs = vi.hoisted(() => {
  const state: Stubs = {
    component: undefined,
    query: { data: undefined, isError: false },
    media: [],
    people: [],
    personEdit: [],
  };
  return Object.assign(state, { setLabel: vi.fn<(variables: { faceIds: number[]; personName: string }) => void>() });
});

/** The props the page last handed one of its stubbed children. */
function last<Props>(rendered: Props[]): Props {
  const props = rendered.at(-1);
  if (!props) throw new Error("the page did not render it");
  return props;
}

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => {
    const route = (options?: { component?: React.ComponentType }) => {
      stubs.component = options?.component;
      return route;
    };
    route.useParams = () => ({ id: "abc" });
    return route;
  },
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("../../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../../api_client/photos/hooks", () => ({ useFetchPhotoDetailsQuery: () => stubs.query }));
vi.mock("../../api_client/faces", () => ({ useSetFacesPersonLabelMutation: () => ({ mutate: stubs.setLabel }) }));
vi.mock("../../service/notifications", () => ({ notification: { removeFacesFromPerson: () => {} } }));
vi.mock("../../i18n", () => ({ i18nResolvedLanguage: () => "en" }));
vi.mock("../../components/lightbox", () => ({
  MediaDisplay: (props: MediaDisplayProps) => {
    stubs.media.push(props);
    return null;
  },
}));
vi.mock("../../components/lightbox/PeopleSection", () => ({
  PeopleSection: (props: React.ComponentProps<typeof PeopleSection>) => {
    stubs.people.push(props);
    return null;
  },
}));
vi.mock("../../components/modals/ModalPersonEdit", () => ({
  ModalPersonEdit: (props: React.ComponentProps<typeof ModalPersonEdit>) => {
    stubs.personEdit.push(props);
    return null;
  },
}));
vi.mock("../../components/common/BreadcrumbPath", () => ({ BreadcrumbPath: () => null }));
vi.mock("../../components/lightbox/AlbumsSection", () => ({ AlbumsSection: () => null }));
vi.mock("../../components/lightbox/CameraInfoComponent", () => ({ CameraInfoComponent: () => null }));
vi.mock("../../components/lightbox/Description", () => ({ Description: () => null }));
vi.mock("../../components/lightbox/FileInfoComponent", () => ({ FileInfoComponent: () => null }));
vi.mock("../../components/lightbox/KeywordsSection", () => ({ KeywordsSection: () => null }));
vi.mock("../../components/lightbox/LocationSection", () => ({ LocationSection: () => null }));
vi.mock("../../components/lightbox/SimilarPhotosSection", () => ({ SimilarPhotosSection: () => null }));
vi.mock("../../components/lightbox/TagsSection", () => ({ TagsSection: () => null }));
vi.mock("../../components/lightbox/TimestampItem", () => ({ TimestampItem: () => null }));

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
  await import("./photo.$id");
});

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await defined(mounted.pop())();
  stubs.query = { data: undefined, isError: false };
  stubs.media.length = 0;
  stubs.people.length = 0;
  stubs.personEdit.length = 0;
  stubs.setLabel.mockClear();
});

async function renderPage() {
  const Page = stubs.component;
  if (!Page) {
    throw new Error("the route module did not register its component");
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <Page />
      </MantineProvider>
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

const video = makePhoto({
  id: "abc",
  image_hash: "abc",
  image_path: ["C:\\Photos\\Videos\\clip.mp4"],
  video: true,
  video_playback_type: 'video/mp4; codecs="hvc1.2.4.L120.90"',
  exif_timestamp: null,
  size: 1024,
  width: 1920,
  height: 1080,
  people: [],
});

describe("single-photo page", () => {
  it("says the photo cannot be found instead of loading forever", async () => {
    stubs.query = { data: undefined, isError: true };

    const container = await renderPage();

    expect(container.textContent).toContain("photopage.notfound");
    expect(container.textContent).not.toContain("photopage.loading");
  });

  it("hands the details to the player, which decides whether to convert from them", async () => {
    stubs.query = { data: video, isError: false };

    await renderPage();

    expect(last(stubs.media).type).toBe("video");
    expect(last(stubs.media).photoDetails).toBe(video);
  });

  it("names the file from a Windows path too", async () => {
    stubs.query = { data: video, isError: false };

    const container = await renderPage();

    expect(container.textContent).toContain("clip.mp4");
    expect(container.textContent).not.toContain("Videos\\clip.mp4");
  });

  it("opens the person picker for a face and moves a face off its person", async () => {
    stubs.query = { data: video, isError: false };
    await renderPage();

    await act(async () => last(stubs.people).onPersonEdit(12, "/media/faces/12.jpg"));
    expect(last(stubs.personEdit).isOpen).toBe(true);
    expect(last(stubs.personEdit).selectedFaces).toEqual([{ face_id: 12, face_url: "/media/faces/12.jpg" }]);

    await act(async () => last(stubs.people).notThisPerson(12));
    expect(stubs.setLabel).toHaveBeenCalledWith({ faceIds: [12], personName: "Unknown - Other" });
  });
});
