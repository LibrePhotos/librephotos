/**
 * The photo editor takes the viewer's place in the lightbox: while it is open none of the viewer's
 * keys act (D would trash the photo under the editor, the arrows would step to another), and closing
 * it shows the same photo with its keys back. The viewer is real down to its hotkeys; its heavy
 * parts, the toolbar and the editor are stubs.
 */
import type { Photo } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { Lightbox } from "./Lightbox";
import type { LightboxItem } from "./lightbox.types";
import { useLightboxCommands } from "./lightboxCommands";
import { usePhotoEditorLauncher } from "./photoEditorLauncher";
import { makePhoto } from "./photoFixture.test-utils";

const stubs = vi.hoisted(() => ({
  trash: vi.fn<() => void>(),
  details: undefined as Photo | undefined,
}));

/** The toolbar: an Edit button when the lightbox offers the editor, and the trash command (D). */
function ToolbarStub() {
  const openEditor = usePhotoEditorLauncher();
  const commands = useLightboxCommands();
  useEffect(() => commands.on("delete", stubs.trash), [commands]);
  return openEditor ? (
    <button type="button" onClick={openEditor}>
      Edit
    </button>
  ) : (
    <span>No editor</span>
  );
}

vi.mock("./LightboxControls", () => ({ LightboxControls: ToolbarStub }));
vi.mock("../editor/LazyPhotoEditor", () => ({
  LazyPhotoEditor: ({ photo, onClose }: { photo: Photo; onClose: () => void }) => (
    <button type="button" data-editing={photo.id} onClick={onClose}>
      Close editor
    </button>
  ),
}));
vi.mock("@mantine/carousel", () => {
  const Carousel = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  Carousel.Slide = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Carousel };
});
vi.mock("./MediaDisplay", () => ({ MediaDisplay: () => null }));
vi.mock("./ThumbnailNavigation", () => ({ ThumbnailNavigation: () => null }));
vi.mock("./Sidebar", () => ({ Sidebar: () => null }));
vi.mock("./ImagePreloader", () => ({ ImagePreloader: () => null }));
vi.mock("./VideoPlayer", () => ({ SEEK_STEP_SECONDS: 10, SEEK_LONG_STEP_SECONDS: 60 }));
vi.mock("../modals/ModalPersonEdit", () => ({ ModalPersonEdit: () => null }));
vi.mock("../../api_client/faces", () => ({ useAddFaceMutation: () => ({ mutate: () => {} }) }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ userId: 1, isAuthenticated: true }) }));
vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoDetailsQuery: () => ({ data: stubs.details, isLoading: false, isError: false }),
}));
vi.mock("../../api_client/photos/hooks/useRotatePhotosMutation", () => ({
  useRotatePhotosMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../hooks/useCopyPhotoToClipboard", () => ({
  useCopyPhotoToClipboard: () => ({ supported: false, isCopying: false, copy: () => {} }),
}));
vi.mock("../../api_client/user/hooks", () => ({ useCurrentUserSelfDetailsQuery: () => ({ data: undefined }) }));
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

const items: LightboxItem[] = ["a", "b", "c"].map(id => ({ id, image_hash: `h${id}`, type: "image" }));

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  stubs.trash.mockReset();
  stubs.details = undefined;
});

async function open(ownerId = 1) {
  stubs.details = makePhoto({
    id: "a",
    image_hash: "ha",
    video: false,
    owner: { id: ownerId, username: "u", first_name: "", last_name: "" },
  });
  const onImageChange = vi.fn<(id: string) => void>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <Lightbox
          idx2hash={items}
          selectedImage="a"
          isPublic={false}
          onCloseRequest={() => {}}
          onChangedIndex={() => {}}
          onImageChange={onImageChange}
        />
      </MantineProvider>
    );
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return { onImageChange };
}

async function key(name: string) {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: name, code: name, bubbles: true }));
  });
}

const button = (text: string) => [...document.querySelectorAll("button")].find(item => item.textContent === text);

describe("the photo editor in the lightbox", () => {
  it("leaves none of the viewer's keys acting while it is open, and gives them back on close", async () => {
    const { onImageChange } = await open();
    await act(async () => button("Edit")?.click());
    expect(document.querySelector("[data-editing]")?.getAttribute("data-editing")).toBe("a");

    await key("d");
    await key("ArrowRight");
    await key("ArrowLeft");
    await key("f");
    expect(stubs.trash).not.toHaveBeenCalled();
    expect(onImageChange).not.toHaveBeenCalled();

    await act(async () => button("Close editor")?.click());
    expect(document.querySelector("[data-editing]")).toBeNull();
    expect(button("Edit")).toBeDefined();
    await key("d");
    expect(stubs.trash).toHaveBeenCalledTimes(1);
    await key("ArrowRight");
    expect(onImageChange).toHaveBeenCalledWith("b");
  });

  it("offers no editor for someone else's photo", async () => {
    await open(2);
    expect(button("Edit")).toBeUndefined();
    expect(document.body.textContent).toContain("No editor");
  });
});
