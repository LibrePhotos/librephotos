/**
 * The owner's cards: a card per detail the photo has, each with the
 * lightbox's editor, and one "Add details" card for the rest instead of a
 * column of "No ..." rows; picking one opens its editor straight away.
 */
import type { Photo, Tag } from "@librephotos/api-client";
import { Media } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import type { Description } from "../lightbox/Description";
import type { LocationSection } from "../lightbox/LocationSection";
import type { PeopleSection } from "../lightbox/PeopleSection";
import { makePhoto } from "../lightbox/photoFixture.test-utils";
import type { TagsSection } from "../lightbox/TagsSection";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import type { ModalPersonEdit } from "../modals/ModalPersonEdit";
import { OwnerPhotoDetails } from "./OwnerPhotoDetails";

type Stubs = {
  tags: Tag[] | undefined;
  albums: { id: number }[] | undefined;
  people: React.ComponentProps<typeof PeopleSection>[];
  caption: React.ComponentProps<typeof Description>[];
  tagSections: React.ComponentProps<typeof TagsSection>[];
  place: React.ComponentProps<typeof LocationSection>[];
  personEdit: React.ComponentProps<typeof ModalPersonEdit>[];
};

const stubs = vi.hoisted(() => {
  const state: Stubs = {
    tags: [],
    albums: [],
    people: [],
    caption: [],
    tagSections: [],
    place: [],
    personEdit: [],
  };
  return Object.assign(state, {
    setLabel: vi.fn<(variables: { faceIds: number[]; personName: string }) => void>(),
  });
});

function last<Props>(rendered: Props[]): Props {
  const props = rendered.at(-1);
  if (!props) throw new Error("not rendered");
  return props;
}

vi.mock("../../api_client/faces", () => ({
  useSetFacesPersonLabelMutation: () => ({ mutate: stubs.setLabel }),
  useDetectFacesReport: () => null,
  useDrawnFaceResult: () => null,
}));
vi.mock("../../api_client/photos/hooks", () => ({ useFetchPhotoAlbumsQuery: () => ({ data: stubs.albums }) }));
vi.mock("../../api_client/settings/hooks", () => ({
  useGetSettingsQuery: () => ({ data: { tagging_model: "openclip_vitb32" } }),
}));
vi.mock("../../api_client/tags/hooks", () => ({ useFetchPhotoTagsQuery: () => ({ data: stubs.tags }) }));
vi.mock("../lightbox/PeopleSection", () => ({
  PeopleSection: (props: React.ComponentProps<typeof PeopleSection>) => {
    stubs.people.push(props);
    return <div data-section="people">{props.heading}</div>;
  },
}));
vi.mock("../lightbox/Description", () => ({
  Description: (props: React.ComponentProps<typeof Description>) => {
    stubs.caption.push(props);
    return <div data-section="caption">{props.heading}</div>;
  },
}));
vi.mock("../lightbox/TagsSection", () => ({
  TagsSection: (props: React.ComponentProps<typeof TagsSection>) => {
    stubs.tagSections.push(props);
    return <div data-section="tags">{props.heading}</div>;
  },
}));
vi.mock("../lightbox/LocationSection", () => ({
  LocationSection: (props: React.ComponentProps<typeof LocationSection>) => {
    stubs.place.push(props);
    return <div data-section="place">{props.heading}</div>;
  },
}));
vi.mock("../lightbox/AlbumsSection", () => ({ AlbumsSection: () => <div data-section="albums" /> }));
vi.mock("../lightbox/SimilarPhotosSection", () => ({ SimilarPhotosSection: () => <div data-section="similar" /> }));
vi.mock("./FileCard", () => ({ FileCard: () => <div data-section="file" /> }));
vi.mock("../modals/ModalPersonEdit", () => ({
  ModalPersonEdit: (props: React.ComponentProps<typeof ModalPersonEdit>) => {
    stubs.personEdit.push(props);
    return null;
  },
}));

beforeAll(setUpMantineDom);

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await defined(mounted.pop())();
  stubs.tags = [];
  stubs.albums = [];
  stubs.people.length = 0;
  stubs.caption.length = 0;
  stubs.tagSections.length = 0;
  stubs.place.length = 0;
  stubs.personEdit.length = 0;
  stubs.setLabel.mockClear();
});

const faceDrawing = { isDrawing: false, start: vi.fn<() => void>(), cancel: vi.fn<() => void>() };

async function renderDetails(photo: Photo, drawing = faceDrawing) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <OwnerPhotoDetails photo={photo} setFaceLocation={() => {}} faceDrawing={drawing} />
      </MantineProvider>
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

/** The cards on screen, by the section each one holds. */
function sections(container: HTMLElement): (string | undefined)[] {
  return [...container.querySelectorAll<HTMLElement>("[data-section]")].map(el => el.dataset.section);
}

function button(container: HTMLElement, name: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>("button")].find(el => el.textContent?.trim() === name);
  if (!found) throw new Error(`no button "${name}"`);
  return found;
}

const bare = makePhoto({ id: "p1", image_hash: "h1" });

const full = makePhoto({
  id: "p1",
  image_hash: "h1",
  people: [
    {
      name: "Anna",
      type: "user",
      probability: 1,
      location: { top: 0, bottom: 1, left: 0, right: 1 },
      face_url: "/f/1.jpg",
      face_id: 1,
    },
  ],
  captions_json: { user_caption: "Last swim" },
  search_location: "Praia da Marinha",
  camera: "X-T5",
  similar_photos: [{ image_hash: "other", type: Media.IMAGE }],
});

describe("owner's photo details", () => {
  it("folds a bare photo's missing details into one card of buttons", async () => {
    const container = await renderDetails(bare);
    expect(sections(container)).toEqual(["file"]);
    for (const offer of ["photopage.add.caption", "photopage.add.tags", "photopage.add.place", "photopage.add.face"]) {
      expect(button(container, offer)).toBeDefined();
    }
    expect(container.textContent).not.toContain("photopage.camera.title");
  });

  it("gives every detail the photo has its own card, and offers nothing", async () => {
    stubs.tags = [{ id: 1, name: "family", photo_count: 1 }];
    stubs.albums = [{ id: 7 }];
    const container = await renderDetails(full);
    expect(sections(container)).toEqual(["people", "caption", "tags", "place", "file", "albums", "similar"]);
    expect(container.textContent).not.toContain("photopage.add.title");
    expect(container.textContent).toContain("photopage.camera.title");
    // Each section shows the card's heading next to its own edit controls.
    expect(last(stubs.caption).heading).toBeDefined();
    expect(last(stubs.caption).startEditing).toBe(false);
    expect(last(stubs.place).startEditing).toBe(false);
  });

  it("opens the editor of a detail picked from Add details", async () => {
    const container = await renderDetails(bare);
    await act(async () => button(container, "photopage.add.caption").click());
    expect(sections(container)).toEqual(["caption", "file"]);
    expect(last(stubs.caption).startEditing).toBe(true);

    await act(async () => button(container, "photopage.add.tags").click());
    expect(last(stubs.tagSections).startEditing).toBe(true);

    await act(async () => button(container, "photopage.add.place").click());
    expect(last(stubs.place).startEditing).toBe(true);
    expect(container.textContent).toContain("photopage.add.face");
  });

  it("starts drawing a face from Mark a face, and shows People while it is drawn", async () => {
    const start = vi.fn<() => void>();
    const container = await renderDetails(bare, { ...faceDrawing, start });
    await act(async () => button(container, "photopage.add.face").click());
    expect(start).toHaveBeenCalledTimes(1);

    const drawing = await renderDetails(bare, { ...faceDrawing, isDrawing: true });
    expect(sections(drawing)).toContain("people");
    expect(drawing.textContent).not.toContain("photopage.add.face");
  });

  it("offers no face for a video", async () => {
    const container = await renderDetails({ ...bare, video: true });
    expect(container.textContent).not.toContain("photopage.add.face");
    expect(container.textContent).toContain("photopage.add.caption");
  });

  it("neither shows nor offers tags while they load", async () => {
    stubs.tags = undefined;
    const container = await renderDetails(bare);
    expect(sections(container)).not.toContain("tags");
    expect(container.textContent).not.toContain("photopage.add.tags");
  });

  it("keeps the caption card for the photo's Things without a caption", async () => {
    const things = makePhoto({ ...bare, captions_json: { openclip_vitb32: { tags: ["beach"] } } });
    const container = await renderDetails(things);
    expect(sections(container)).toContain("caption");
  });

  it("names a face with the person picker and moves one off its person", async () => {
    await renderDetails(full);
    await act(async () => last(stubs.people).onPersonEdit(1, "/f/1.jpg"));
    expect(last(stubs.personEdit).isOpen).toBe(true);
    expect(last(stubs.personEdit).selectedFaces).toEqual([{ face_id: 1, face_url: "/f/1.jpg" }]);
    await act(async () => last(stubs.personEdit).onRequestClose());
    expect(last(stubs.personEdit).isOpen).toBe(false);

    await act(async () => last(stubs.people).notThisPerson(1));
    expect(stubs.setLabel).toHaveBeenCalledWith({ faceIds: [1], personName: "Unknown - Other" });
  });
});
