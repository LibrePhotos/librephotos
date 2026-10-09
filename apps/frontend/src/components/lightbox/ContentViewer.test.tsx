/**
 * The viewer's own wiring: when Escape is its to handle, when a drag may swipe,
 * what the main slide is shown as while details load, and where it goes after
 * a photo leaves for the trash. Everything it renders is stubbed; only the
 * decisions ContentViewer makes itself are under test.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ContentViewer, escapeTargetsLightbox } from "./ContentViewer";

const stubs = vi.hoisted(() => ({
  carousel: [] as Array<Record<string, any>>,
  media: [] as Array<Record<string, any>>,
  controls: [] as Array<Record<string, any>>,
  details: { data: undefined as object | undefined, isLoading: false },
}));

vi.mock("@mantine/carousel", () => {
  const Carousel = (props: Record<string, any>) => {
    stubs.carousel.push(props);
    return <div>{props.children}</div>;
  };
  Carousel.Slide = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Carousel };
});
vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  motion: { div: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> },
}));
vi.mock("./MediaDisplay", () => ({
  LIGHTBOX_PHOTO_HEIGHT: "82vh",
  LIGHTBOX_VIDEO_HEIGHT: "80vh",
  MediaDisplay: (props: Record<string, any>) => {
    if (props.isMainContent) stubs.media.push(props);
    return null;
  },
}));
vi.mock("./LightboxControls", () => ({
  LightboxControls: (props: Record<string, any>) => {
    stubs.controls.push(props);
    // Something to tab to, at either end of the toolbar.
    return (
      <>
        <button type="button">first</button>
        <button type="button">last</button>
      </>
    );
  },
}));
vi.mock("./Sidebar", () => ({ Sidebar: () => null }));
vi.mock("./ThumbnailNavigation", () => ({ ThumbnailNavigation: () => null }));
vi.mock("./ImagePreloader", () => ({ ImagePreloader: () => null }));
vi.mock("./VideoPlayer", () => ({
  requestLightboxSeek: () => {},
  SEEK_STEP_SECONDS: 10,
  SEEK_LONG_STEP_SECONDS: 60,
}));
vi.mock("../modals/ModalPersonEdit", () => ({
  ModalPersonEdit: () => <div data-testid="person-edit" />,
}));
vi.mock("../../api_client/faces", () => ({ useAddFaceMutation: () => ({ mutate: () => {} }) }));
vi.mock("../../api_client/photos/hooks", () => ({ useFetchPhotoDetailsQuery: () => stubs.details }));
vi.mock("../../api_client/photos/hooks/useRotatePhotosMutation", () => ({
  useRotatePhotosMutation: () => ({ mutate: () => {} }),
}));
vi.mock("../../api_client/user/hooks", () => ({ useCurrentUserSelfDetailsQuery: () => ({ data: undefined }) }));
vi.mock("../../hooks/useCopyPhotoToClipboard", () => ({
  useCopyPhotoToClipboard: () => ({ supported: false, isCopying: false, copy: () => {} }),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
});

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  stubs.carousel.length = 0;
  stubs.media.length = 0;
  stubs.controls.length = 0;
  stubs.details = { data: undefined, isLoading: false };
});

async function renderViewer(props: Partial<React.ComponentProps<typeof ContentViewer>> = {}) {
  const handlers = {
    onCloseRequest: vi.fn(),
    onMovePrevRequest: vi.fn(),
    onMoveNextRequest: vi.fn(),
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = async (overrides: Partial<React.ComponentProps<typeof ContentViewer>>) => {
    await act(async () => {
      root.render(
        <MantineProvider>
          <ContentViewer
            mainSrc="b"
            mainSrcHash="hb"
            nextSrc="c"
            nextSrcHash="hc"
            prevSrc="a"
            prevSrcHash="ha"
            type="photo"
            enableZoom
            isPublic={false}
            onImageLoad={() => {}}
            {...handlers}
            {...overrides}
          />
        </MantineProvider>
      );
    });
  };
  await render(props);
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  /** Show another item, as stepping through the list does. */
  const rerender = (overrides: Partial<React.ComponentProps<typeof ContentViewer>>) =>
    render({ ...props, ...overrides });
  return { ...handlers, rerender };
}

async function press(key: string, target: Element = document.body, init: KeyboardEventInit = {}) {
  let event!: KeyboardEvent;
  await act(async () => {
    event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
  });
  return event;
}

/** The step to the next item, where the carousel and the list both move on. */
const NEXT_ITEM = { mainSrc: "c", mainSrcHash: "hc", prevSrc: "b", prevSrcHash: "hb", nextSrc: "d", nextSrcHash: "hd" };

describe("escapeTargetsLightbox", () => {
  it("claims a key pressed on the page or inside the lightbox", () => {
    const lightbox = document.createElement("div");
    lightbox.setAttribute("role", "dialog");
    const button = document.createElement("button");
    lightbox.appendChild(button);

    expect(escapeTargetsLightbox(document.body, lightbox)).toBe(true);
    expect(escapeTargetsLightbox(button, lightbox)).toBe(true);
  });

  it("leaves a key pressed in a dialog opened on top of it alone", () => {
    const lightbox = document.createElement("div");
    lightbox.setAttribute("role", "dialog");
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    const input = document.createElement("button");
    other.appendChild(input);

    expect(escapeTargetsLightbox(input, lightbox)).toBe(false);
  });

  it("leaves a key alone that Mantine marks for an open menu or combobox", () => {
    const item = document.createElement("button");
    item.setAttribute("data-mantine-stop-propagation", "true");

    expect(escapeTargetsLightbox(item, null)).toBe(false);
  });
});

describe("ContentViewer Escape", () => {
  it("closes once on Escape", async () => {
    const { onCloseRequest } = await renderViewer();

    await press("Escape");

    expect(onCloseRequest).toHaveBeenCalledTimes(1);
  });

  it("stays open when Escape closes a dialog opened on top of it", async () => {
    const { onCloseRequest } = await renderViewer();
    const nested = document.createElement("div");
    nested.setAttribute("role", "dialog");
    const button = document.createElement("button");
    nested.appendChild(button);
    document.body.appendChild(nested);

    await press("Escape", button);

    expect(onCloseRequest).not.toHaveBeenCalled();
    nested.remove();
  });

  it("stays open when Escape is typed into a field", async () => {
    const { onCloseRequest } = await renderViewer();
    const input = document.createElement("input");
    document.body.appendChild(input);

    await press("Escape", input);

    expect(onCloseRequest).not.toHaveBeenCalled();
    input.remove();
  });
});

describe("ContentViewer swiping", () => {
  it("swipes until the photo is zoomed, then pans instead", async () => {
    await renderViewer();
    expect(stubs.carousel.at(-1)!.emblaOptions).toEqual({ watchDrag: true });

    await press("z");

    expect(stubs.carousel.at(-1)!.emblaOptions).toEqual({ watchDrag: false });
  });

  it("drops the zoom on the next item, so swiping works there again", async () => {
    const { rerender } = await renderViewer();
    await press("z");

    await rerender(NEXT_ITEM);

    expect(stubs.carousel.at(-1)!.emblaOptions).toEqual({ watchDrag: true });
    expect(stubs.controls.at(-1)!.isZoomed).toBe(false);
    expect(stubs.media.at(-1)!.scale).toBe(1);
  });
});

describe("ContentViewer focus", () => {
  // The body takes focus on open and on a click on the photo; Mantine's trap
  // only wraps from the ends of its tab order, which the body is not.
  const lightboxBody = () => document.querySelector<HTMLElement>("[data-autofocus]")!;

  it("keeps Shift+Tab from the body inside the lightbox", async () => {
    await renderViewer();
    lightboxBody().focus();

    const event = await press("Tab", lightboxBody(), { shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.textContent).toBe("last");
  });

  it("starts Tab from the body at the first control", async () => {
    await renderViewer();
    lightboxBody().focus();

    await press("Tab", lightboxBody());

    expect(document.activeElement?.textContent).toBe("first");
  });

  it("leaves Tab between the controls to the focus trap", async () => {
    await renderViewer();
    const first = [...document.querySelectorAll("button")].find(button => button.textContent === "first")!;
    first.focus();

    const event = await press("Tab", first);

    expect(event.defaultPrevented).toBe(false);
  });
});

describe("ContentViewer main slide", () => {
  it("shows a video as its poster until the details say how to play it", async () => {
    stubs.details = { data: undefined, isLoading: true };

    await renderViewer({ type: "video" });

    expect(stubs.media.at(-1)!.type).toBe("photo");
  });

  it("plays it once they are there", async () => {
    stubs.details = { data: { image_hash: "hb", video: true }, isLoading: false };

    await renderViewer({ type: "video" });

    expect(stubs.media.at(-1)!.type).toBe("video");
    expect(stubs.media.at(-1)!.photoDetails).toEqual({ image_hash: "hb", video: true });
  });

  it("does not wait on a public page, which never fetches details", async () => {
    await renderViewer({ type: "video", isPublic: true });

    expect(stubs.media.at(-1)!.type).toBe("video");
  });
});

describe("ContentViewer people picker", () => {
  it("is not mounted for a visitor, whose people list would be refused", async () => {
    await renderViewer({ isPublic: true });

    expect(document.querySelector('[data-testid="person-edit"]')).toBeNull();
  });

  it("is there for the owner, to name a face drawn on the photo", async () => {
    await renderViewer();

    expect(document.querySelector('[data-testid="person-edit"]')).not.toBeNull();
  });
});

describe("ContentViewer after a photo leaves for the trash", () => {
  it("moves on to the next photo", async () => {
    const { onMoveNextRequest, onCloseRequest } = await renderViewer();

    await act(async () => stubs.controls.at(-1)!.onAfterTrashToggle());

    expect(onMoveNextRequest).toHaveBeenCalledTimes(1);
    expect(onCloseRequest).not.toHaveBeenCalled();
  });

  it("steps back from the last photo", async () => {
    const { onMovePrevRequest } = await renderViewer({ nextSrc: null, nextSrcHash: null });

    await act(async () => stubs.controls.at(-1)!.onAfterTrashToggle());

    expect(onMovePrevRequest).toHaveBeenCalledTimes(1);
  });

  it("stays put when the user has moved on before the request finished", async () => {
    const { onMoveNextRequest, onMovePrevRequest, onCloseRequest, rerender } = await renderViewer();
    // Bound when the photo was trashed, as the mutation's onSuccess is.
    const afterTrash = stubs.controls.at(-1)!.onAfterTrashToggle;

    await rerender(NEXT_ITEM);
    await act(async () => afterTrash());

    expect(onMoveNextRequest).not.toHaveBeenCalled();
    expect(onMovePrevRequest).not.toHaveBeenCalled();
    expect(onCloseRequest).not.toHaveBeenCalled();
  });

  it("closes when it was the only one", async () => {
    const { onCloseRequest } = await renderViewer({
      nextSrc: null,
      nextSrcHash: null,
      prevSrc: null,
      prevSrcHash: null,
    });

    await act(async () => stubs.controls.at(-1)!.onAfterTrashToggle());

    expect(onCloseRequest).toHaveBeenCalledTimes(1);
  });
});
