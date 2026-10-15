/**
 * Unsaved edits in the lightbox (#2284). The editors keep their draft per photo and remount on the
 * next one, so stepping on, picking a stack photo, closing or going Back threw a half-typed caption
 * away without a word. Now each of those asks "Discard unsaved changes?" while an editor holds an
 * edit that differs from the saved value: Keep editing stays with the draft, Discard goes on.
 *
 * The lightbox runs as a photo list runs it (usePhotoListLightbox, the open photo in `?photo=`)
 * under a real browser-history router, so Back is a real history step. The viewer is real down to
 * its hotkeys; its heavy parts are stubbed, and the details panel is one editor that reports its
 * draft like the real ones do.
 */
import { Media, type PigPhoto } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import React, { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import type { PigHandle } from "../photolist/PhotoListView";
import { validatePhotoSearch } from "../photolist/photoSearch";
import { usePhotoListLightbox } from "../photolist/usePhotoListLightbox";
import { Lightbox } from "./Lightbox";
import { NEXT_KEY } from "./lightbox.hotkeys";
import type { ThumbnailNavigationProps } from "./ThumbnailNavigation";
import { useRegisterDraft } from "./unsavedDrafts";

vi.mock("@mantine/carousel", () => {
  const Carousel = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  Carousel.Slide = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Carousel };
});
vi.mock("motion/react", () => ({
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
  motion: { div: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> },
}));
vi.mock("./MediaDisplay", () => ({
  LIGHTBOX_PHOTO_HEIGHT: "82vh",
  LIGHTBOX_VIDEO_HEIGHT: "80vh",
  MediaDisplay: () => null,
}));
vi.mock("./LightboxControls", () => ({
  LightboxControls: ({ onCloseRequest }: { onCloseRequest: () => void }) => (
    <button type="button" onClick={onCloseRequest}>
      Close
    </button>
  ),
}));
vi.mock("./ThumbnailNavigation", () => ({
  ThumbnailNavigation: ({ onMoveNextRequest }: ThumbnailNavigationProps) => (
    <button type="button" onClick={onMoveNextRequest}>
      Next photo
    </button>
  ),
}));
vi.mock("./Sidebar", () => ({
  Sidebar: ({ id, onPhotoSelect }: { id: string; onPhotoSelect?: (photoId: string) => void }) => (
    <div>
      {/* Keyed by photo like the real editors, so a draft never reaches the next photo. */}
      <CaptionDraft key={id} />
      <button type="button" onClick={() => onPhotoSelect?.("c")}>
        Stack photo c
      </button>
    </div>
  ),
}));
vi.mock("./ImagePreloader", () => ({ ImagePreloader: () => null }));
vi.mock("./VideoPlayer", () => ({ SEEK_STEP_SECONDS: 10, SEEK_LONG_STEP_SECONDS: 60 }));
vi.mock("../modals/ModalPersonEdit", () => ({ ModalPersonEdit: () => null }));
vi.mock("../../api_client/faces", () => ({ useAddFaceMutation: () => ({ mutate: () => {} }) }));
vi.mock("../../api_client/photos/hooks", () => ({
  useFetchPhotoDetailsQuery: () => ({ data: undefined, isLoading: false, isError: false }),
}));
vi.mock("../../api_client/photos/hooks/useRotatePhotosMutation", () => ({
  useRotatePhotosMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../api_client/user/hooks", () => ({ useCurrentUserSelfDetailsQuery: () => ({ data: undefined }) }));
vi.mock("../../hooks/useCopyPhotoToClipboard", () => ({
  useCopyPhotoToClipboard: () => ({ supported: false, isCopying: false, copy: () => {} }),
}));

/** An editor as the caption, date, tags and location ones report: dirty while its draft differs. */
function CaptionDraft() {
  const [draft, setDraft] = useState("");
  useRegisterDraft("caption", draft !== "");
  return (
    <div>
      <output data-testid="draft">{draft}</output>
      <button type="button" onClick={() => setDraft("A long caption")}>
        Type a caption
      </button>
      <button type="button" onClick={() => setDraft("")}>
        Undo typing
      </button>
    </div>
  );
}

const items: PigPhoto[] = ["a", "b", "c"].map(id => ({
  id,
  image_hash: `h${id}`,
  aspectRatio: 1,
  type: Media.IMAGE,
  is_hdr: false,
  rating: 0,
  shared_to: [],
  isTemp: false,
  has_raw_variant: false,
}));

/** The photo list's page, reduced to its lightbox. */
function PhotosPage() {
  const pigRef = useRef<PigHandle<PigPhoto> | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const lightbox = usePhotoListLightbox(items, pigRef, gridRef, { ready: true, isPublic: false });
  return (
    <>
      <button type="button" onClick={() => lightbox.showLightbox("a", true)}>
        Open a
      </button>
      {lightbox.lightboxOpen && (
        <Lightbox
          idx2hash={items}
          selectedImage={lightbox.lightboxImageId}
          isPublic={false}
          onCloseRequest={lightbox.closeLightbox}
          onImageChange={lightbox.handleLightboxImageChange}
          onChangedIndex={lightbox.handleLightboxIndexChange}
        />
      )}
    </>
  );
}

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

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

function buttonNamed(label: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll("button")].find(b => b.textContent?.trim() === label);
  if (!button) throw new Error(`button "${label}" not found`);
  return button;
}

const discardDialog = () =>
  [...document.body.querySelectorAll('[role="dialog"]')].find(dialog =>
    dialog.textContent?.includes("Discard unsaved changes?")
  ) ?? null;

const draft = () => document.body.querySelector('[data-testid="draft"]')?.textContent;

async function click(label: string) {
  await act(async () => buttonNamed(label).click());
}

async function press(key: string) {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** The photos page with photo `a` open, its details panel showing. */
async function openLightbox() {
  window.history.replaceState(null, "", "/photos");
  const rootRoute = createRootRoute({ component: Outlet });
  const photosRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/photos",
    component: PhotosPage,
    validateSearch: validatePhotoSearch,
  });
  const router = createRouter({ routeTree: rootRoute.addChildren([photosRoute]), history: createBrowserHistory() });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <RouterProvider router={router} />
      </MantineProvider>
    );
  });
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  };
  await act(async () => router.load());
  await click("Open a");
  await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ photo: "a" }));
  // "i" shows the details panel, where the editors are.
  await press("i");
  const photo = () => router.state.location.search.photo;
  return { router, photo };
}

describe("lightbox with an unsaved edit", () => {
  it("asks before the next-photo button steps on; Keep editing keeps the photo and the draft", async () => {
    const { photo } = await openLightbox();
    await click("Type a caption");

    await click("Next photo");

    await vi.waitFor(() => expect(discardDialog()).not.toBeNull());
    expect(photo()).toBe("a");
    await click("Keep editing");
    await vi.waitFor(() => expect(discardDialog()).toBeNull());
    expect(photo()).toBe("a");
    expect(draft()).toBe("A long caption");
  });

  it("steps on after Discard, and the next photo's editor starts empty", async () => {
    const { photo } = await openLightbox();
    await click("Type a caption");

    await click("Next photo");
    await vi.waitFor(() => expect(discardDialog()).not.toBeNull());
    await click("Discard");

    await vi.waitFor(() => expect(photo()).toBe("b"));
    await vi.waitFor(() => expect(discardDialog()).toBeNull());
    expect(draft()).toBe("");
  });

  it("asks before the arrow key steps on too", async () => {
    const { photo } = await openLightbox();
    await click("Type a caption");

    await press(NEXT_KEY);

    await vi.waitFor(() => expect(discardDialog()).not.toBeNull());
    expect(photo()).toBe("a");
    await click("Discard");
    await vi.waitFor(() => expect(photo()).toBe("b"));
  });

  it("asks before a stack or similar photo replaces this one", async () => {
    const { photo } = await openLightbox();
    await click("Type a caption");

    await click("Stack photo c");

    await vi.waitFor(() => expect(discardDialog()).not.toBeNull());
    await click("Discard");
    await vi.waitFor(() => expect(photo()).toBe("c"));
  });

  it("asks before closing, and closes after Discard", async () => {
    const { router, photo } = await openLightbox();
    await click("Type a caption");

    await click("Close");

    await vi.waitFor(() => expect(discardDialog()).not.toBeNull());
    expect(photo()).toBe("a");
    await click("Discard");
    await vi.waitFor(() => expect(photo()).toBeUndefined());
    expect(router.state.location.pathname).toBe("/photos");
    expect(draft()).toBeUndefined();
  });

  it("asks before Back closes it; Keep editing stays on the photo", async () => {
    const { router, photo } = await openLightbox();
    await click("Type a caption");

    await act(async () => router.history.back());

    await vi.waitFor(() => expect(discardDialog()).not.toBeNull());
    await click("Keep editing");
    await vi.waitFor(() => expect(discardDialog()).toBeNull());
    await vi.waitFor(() => expect(window.location.search).toBe("?photo=a"));
    expect(photo()).toBe("a");
    expect(draft()).toBe("A long caption");
  });

  it("goes Back after Discard", async () => {
    const { photo } = await openLightbox();
    await click("Type a caption");

    await act(async () => window.history.back());
    await vi.waitFor(() => expect(discardDialog()).not.toBeNull());
    await click("Discard");

    await vi.waitFor(() => expect(photo()).toBeUndefined());
    expect(draft()).toBeUndefined();
  });

  it("drops the question when the edit is saved meanwhile, and the next step goes through", async () => {
    const { photo } = await openLightbox();
    await click("Type a caption");
    await click("Next photo");
    await vi.waitFor(() => expect(discardDialog()).not.toBeNull());

    // A save that was in flight lands: the draft equals the saved value again.
    await click("Undo typing");

    await vi.waitFor(() => expect(discardDialog()).toBeNull());
    expect(photo()).toBe("a");
    await click("Next photo");
    await vi.waitFor(() => expect(photo()).toBe("b"));
    expect(discardDialog()).toBeNull();
  });

  it("lets a held Back go once the edit is saved meanwhile", async () => {
    const { photo } = await openLightbox();
    await click("Type a caption");
    await act(async () => window.history.back());
    await vi.waitFor(() => expect(discardDialog()).not.toBeNull());

    await click("Undo typing");

    await vi.waitFor(() => expect(photo()).toBeUndefined());
  });

  it("asks the browser before a reload only while an edit is unsaved", async () => {
    await openLightbox();
    const reload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(reload()).toBe(false);

    await click("Type a caption");
    expect(reload()).toBe(true);

    await click("Undo typing");
    expect(reload()).toBe(false);
  });
});

describe("lightbox with an editor open but unchanged", () => {
  it("steps on, closes and goes Back without asking", async () => {
    const { photo } = await openLightbox();
    await click("Type a caption");
    await click("Undo typing");

    await click("Next photo");
    await vi.waitFor(() => expect(photo()).toBe("b"));
    await press(NEXT_KEY);
    await vi.waitFor(() => expect(photo()).toBe("c"));
    expect(discardDialog()).toBeNull();

    await act(async () => window.history.back());
    await vi.waitFor(() => expect(photo()).toBeUndefined());
    expect(discardDialog()).toBeNull();
  });
});
