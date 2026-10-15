/**
 * The lightbox and modals of a photo list. The add-to-album and tag modals clear the selection
 * when they close (their work is done); the share modals only close; the cover picker forgets
 * which album it was picking for. A public list mounts none of the owner's modals. The lightbox
 * closes through the slideshow (#1457), which hands a slideshow's close back to the page.
 */
import { Media } from "@librephotos/api-client";
import type { PigPhoto } from "@librephotos/api-client";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SelectionState } from "../../api_client/photos/types";
import { defined } from "../../util/defined.test-utils";
import type { Lightbox } from "../lightbox/Lightbox";
import { PhotoListDialogs } from "./PhotoListDialogs";
import type { PhotoListDialogState } from "./usePhotoListDialogs";
import type { PhotoListLightbox } from "./usePhotoListLightbox";

type LightboxProps = React.ComponentProps<typeof Lightbox>;
type ModalProps = { isOpen: boolean; onRequestClose: () => void };

const rendered = vi.hoisted(() => ({
  lightbox: undefined as LightboxProps | undefined,
  modals: new Map<string, ModalProps>(),
}));

function recordModal(name: string) {
  return (props: ModalProps) => {
    rendered.modals.set(name, props);
    return null;
  };
}

vi.mock("../lightbox/Lightbox", () => ({
  Lightbox: (props: LightboxProps) => {
    rendered.lightbox = props;
    return null;
  },
}));
vi.mock("../modals/AlbumEdit/AlbumEditModal", () => ({ AlbumEditModal: recordModal("addToAlbum") }));
vi.mock("../modals/ModalTagEdit", () => ({ ModalTagEdit: recordModal("tag") }));
vi.mock("../sharing/ModalPhotosShare", () => ({ ModalPhotosShare: recordModal("sharePhotos") }));
vi.mock("../sharing/ModalAlbumShare", () => ({ ModalAlbumShare: recordModal("albumShare") }));
vi.mock("../modals/AlbumCoverPickerModal", () => ({ AlbumCoverPickerModal: recordModal("coverPicker") }));

const photo: PigPhoto = {
  id: "a",
  image_hash: "a",
  aspectRatio: 1,
  type: Media.IMAGE,
  is_hdr: false,
  rating: 0,
  shared_to: [],
  isTemp: false,
  has_raw_variant: false,
};

const disclosure = () => ({ opened: true, open: vi.fn<() => void>(), close: vi.fn<() => void>() });

function makeDialogs(): PhotoListDialogState {
  return {
    addToAlbum: disclosure(),
    tag: disclosure(),
    sharePhotos: disclosure(),
    albumShare: disclosure(),
    coverPicker: disclosure(),
    coverPickerAlbumType: "useralbum",
    setCoverPickerAlbumType: vi.fn<PhotoListDialogState["setCoverPickerAlbumType"]>(),
  };
}

const lightbox: PhotoListLightbox = {
  currentImageIndexRef: { current: 0 },
  lightboxOpen: true,
  lightboxImageId: "a",
  lightboxAloneItem: undefined,
  showLightbox: () => {},
  closeLightbox: () => {},
  handleLightboxIndexChange: () => {},
  handleLightboxImageChange: () => {},
};

const selection: SelectionState = { selectedItems: [photo], selectMode: true, selectAllMode: false };
const cleared = { selectedItems: [], selectMode: false, selectAllMode: false, selectAllQuery: undefined };

let unmount: (() => void) | undefined;

function render({ isPublic = false, dialogs = makeDialogs(), lightboxState = lightbox } = {}) {
  const updateSelectionState = vi.fn<(state: Partial<SelectionState>) => void>();
  const closeSlideshow = vi.fn<() => void>();
  const root = createRoot(document.createElement("div"));
  act(() =>
    root.render(
      <PhotoListDialogs
        dialogs={dialogs}
        lightbox={lightboxState}
        slideshow={{ active: true, close: closeSlideshow }}
        isPublic={isPublic}
        isUserAlbum
        albumID="7"
        title="Trip"
        idx2hash={[photo]}
        totalCount={1}
        selectionState={selection}
        updateSelectionState={updateSelectionState}
        onSelectCover={() => {}}
      />
    )
  );
  unmount = () => act(() => root.unmount());
  return { dialogs, updateSelectionState, closeSlideshow };
}

const modal = (name: string) => defined(rendered.modals.get(name), `the ${name} modal`);

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  unmount?.();
  rendered.lightbox = undefined;
  rendered.modals.clear();
});

describe("PhotoListDialogs", () => {
  it("opens the lightbox as the slideshow asks, and closes it through the slideshow", () => {
    const { closeSlideshow } = render({ isPublic: true });

    const props = defined(rendered.lightbox, "the lightbox");
    expect(props).toMatchObject({ selectedImage: "a", startSlideshow: true, isPublic: true });
    props.onCloseRequest();
    expect(closeSlideshow).toHaveBeenCalledTimes(1);
  });

  // An address naming a photo the list does not hold (#2231) shows that photo on its own.
  it("hands the lightbox just the photo shown alone", () => {
    const alone = { id: "z", image_hash: "hz", type: "image" };
    render({ lightboxState: { ...lightbox, lightboxImageId: "z", lightboxAloneItem: alone } });

    expect(defined(rendered.lightbox, "the lightbox")).toMatchObject({ selectedImage: "z", idx2hash: [alone] });
  });

  it("mounts none of the owner's modals on a public list", () => {
    render({ isPublic: true });

    expect([...rendered.modals.keys()]).toEqual([]);
  });

  it.each(["addToAlbum", "tag"] as const)("clears the selection when the %s modal closes", name => {
    const { dialogs, updateSelectionState } = render();

    modal(name).onRequestClose();

    expect(dialogs[name].close).toHaveBeenCalledTimes(1);
    expect(updateSelectionState).toHaveBeenCalledWith(cleared);
  });

  it.each(["sharePhotos", "albumShare"] as const)("only closes the %s modal", name => {
    const { dialogs, updateSelectionState } = render();

    modal(name).onRequestClose();

    expect(dialogs[name].close).toHaveBeenCalledTimes(1);
    expect(updateSelectionState).not.toHaveBeenCalled();
  });

  it("forgets the album type when the cover picker closes", () => {
    const { dialogs } = render();

    modal("coverPicker").onRequestClose();

    expect(dialogs.coverPicker.close).toHaveBeenCalledTimes(1);
    expect(dialogs.setCoverPickerAlbumType).toHaveBeenCalledWith(null);
  });
});
