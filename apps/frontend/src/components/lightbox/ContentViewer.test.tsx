/**
 * The viewer's own wiring: when Escape is its to handle, when a drag may swipe,
 * what the main slide is shown as while details load, and where it goes after
 * a photo leaves for the trash. Everything it renders is stubbed; only the
 * decisions ContentViewer makes itself are under test.
 */
import type { Photo } from "@librephotos/api-client";
import type { CarouselProps } from "@mantine/carousel";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { ContentViewer, escapeTargetsLightbox } from "./ContentViewer";
import type { LightboxControlsProps } from "./lightbox.types";
import { useLightboxCommands, type LightboxCommands } from "./lightboxCommands";
import type { MediaDisplayProps } from "./MediaDisplay";

/** What the stubbed details query answers: a test sets only the fields it is about. */
type DetailsStub = { data: Partial<Photo> | undefined; isLoading: boolean };

const stubs = vi.hoisted(() => {
  const carousel: CarouselProps[] = [];
  const media: MediaDisplayProps[] = [];
  const controls: LightboxControlsProps[] = [];
  /** The commands of each render of the toolbar stub: the lightbox's own, as a toolbar would subscribe. */
  const commands: LightboxCommands[] = [];
  const details: DetailsStub = { data: undefined, isLoading: false };
  /** What the viewer asks the rotate mutation for. */
  const rotate: Array<{ image_hash: string; clockwiseDegrees: number }> = [];
  return { carousel, media, controls, commands, details, rotate };
});

/** The last props the stubbed toolbar got. */
function lastControls(): LightboxControlsProps {
  const props = stubs.controls.at(-1);
  if (!props) throw new Error("LightboxControls was not rendered");
  return props;
}

/** What the toolbar calls once the photo is in (or out of) the trash. */
function afterTrashToggle(): () => void {
  const { onAfterTrashToggle } = lastControls();
  if (!onAfterTrashToggle) throw new Error("LightboxControls got no onAfterTrashToggle");
  return onAfterTrashToggle;
}

vi.mock("@mantine/carousel", () => {
  const Carousel = (props: CarouselProps) => {
    stubs.carousel.push(props);
    return <div>{props.children}</div>;
  };
  Carousel.Slide = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Carousel };
});
vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
  motion: { div: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> },
}));
vi.mock("./MediaDisplay", () => ({
  LIGHTBOX_PHOTO_HEIGHT: "82vh",
  LIGHTBOX_VIDEO_HEIGHT: "80vh",
  MediaDisplay: (props: MediaDisplayProps) => {
    if (props.isMainContent) stubs.media.push(props);
    return null;
  },
}));
vi.mock("./LightboxControls", () => ({
  LightboxControls: (props: LightboxControlsProps) => {
    stubs.controls.push(props);
    stubs.commands.push(useLightboxCommands());
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
  SEEK_STEP_SECONDS: 10,
  SEEK_LONG_STEP_SECONDS: 60,
}));
// jsdom has no WebGL; the 360° toggle is usable here.
vi.mock("../panorama/photoSphere", async importOriginal => ({
  ...(await importOriginal<typeof import("../panorama/photoSphere")>()),
  canShowPhotoSphere: () => true,
}));
vi.mock("../../service/notifications", () => ({ notification: { error: () => {} } }));
vi.mock("../modals/ModalPersonEdit", () => ({
  ModalPersonEdit: () => <div data-testid="person-edit" />,
}));
vi.mock("../../api_client/faces", () => {
  // As React Query's: the same function on every render
  const addFace = { mutate: () => {}, reset: () => {}, isPending: false, error: null };
  return { useAddFaceMutation: () => addFace, isNoFaceInBox: () => false, useDetectFacesReport: () => null };
});
vi.mock("../../api_client/photos/hooks", () => ({ useFetchPhotoDetailsQuery: () => stubs.details }));
vi.mock("../../api_client/photos/hooks/useRotatePhotosMutation", () => ({
  useRotatePhotosMutation: () => ({
    mutate: (request: { image_hash: string; clockwiseDegrees: number }) => stubs.rotate.push(request),
  }),
}));
vi.mock("../../api_client/user/hooks", () => ({ useCurrentUserSelfDetailsQuery: () => ({ data: undefined }) }));
vi.mock("../../hooks/useCopyPhotoToClipboard", () => ({
  useCopyPhotoToClipboard: () => ({ supported: false, isCopying: false, copy: () => {} }),
}));

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

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await defined(mounted.pop())();
  stubs.carousel.length = 0;
  stubs.media.length = 0;
  stubs.controls.length = 0;
  stubs.commands.length = 0;
  stubs.rotate.length = 0;
  stubs.details = { data: undefined, isLoading: false };
});

async function renderViewer(props: Partial<React.ComponentProps<typeof ContentViewer>> = {}) {
  const handlers = {
    onCloseRequest: vi.fn<() => void>(),
    onMovePrevRequest: vi.fn<() => void>(),
    onMoveNextRequest: vi.fn<() => void>(),
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

/** What the overlay paints: the theme black, none of it transparent. */
const OPAQUE_BLACK = "color-mix(in srgb, var(--mantine-color-black), transparent 0%)";

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

describe("ContentViewer backdrop", () => {
  // #2229: the grid used to show through a blurred, 80 % overlay around the photo
  it("hides the page behind an opaque black overlay, without a blur", async () => {
    await renderViewer();
    const overlay = defined(document.querySelector<HTMLElement>(".mantine-Modal-overlay"));

    expect(overlay.style.getPropertyValue("--overlay-bg")).toBe(OPAQUE_BLACK);
    expect(overlay.style.getPropertyValue("--overlay-filter")).toBe("");
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
    expect(defined(stubs.carousel.at(-1)).emblaOptions).toEqual({ watchDrag: true });

    await press("z");

    expect(defined(stubs.carousel.at(-1)).emblaOptions).toEqual({ watchDrag: false });
  });

  it("drops the zoom on the next item, so swiping works there again", async () => {
    const { rerender } = await renderViewer();
    await press("z");

    await rerender(NEXT_ITEM);

    expect(defined(stubs.carousel.at(-1)).emblaOptions).toEqual({ watchDrag: true });
    expect(lastControls().isZoomed).toBe(false);
    expect(defined(stubs.media.at(-1)).scale).toBe(1);
  });
});

describe("ContentViewer focus", () => {
  // The body takes focus on open and on a click on the photo, but is not in the
  // tab order itself; Mantine's focus trap still has to keep Tab inside from it.
  const lightboxBody = () => defined(document.querySelector<HTMLElement>("[data-autofocus]"));
  const control = (name: string) =>
    defined([...document.querySelectorAll("button")].find(button => button.textContent === name));

  /** The viewer once the trap has given the body its opening focus, as it is when the user first presses Tab. */
  async function renderOpenedViewer() {
    await renderViewer();
    await act(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(lightboxBody());
  }

  it("keeps Shift+Tab from the body inside the lightbox", async () => {
    await renderOpenedViewer();

    const event = await press("Tab", lightboxBody(), { shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(control("last"));
  });

  it("starts Tab from the body at the first control", async () => {
    await renderOpenedViewer();

    await press("Tab", lightboxBody());

    expect(document.activeElement).toBe(control("first"));
  });

  it("moves Tab on between the controls and wraps from the last one", async () => {
    await renderOpenedViewer();
    control("first").focus();

    await press("Tab", control("first"));
    expect(document.activeElement).toBe(control("last"));

    const event = await press("Tab", control("last"));
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(control("first"));
  });
});

describe("ContentViewer main slide", () => {
  it("shows a video as its poster until the details say how to play it", async () => {
    stubs.details = { data: undefined, isLoading: true };

    await renderViewer({ type: "video" });

    expect(defined(stubs.media.at(-1)).type).toBe("photo");
  });

  it("plays it once they are there", async () => {
    stubs.details = { data: { image_hash: "hb", video: true }, isLoading: false };

    await renderViewer({ type: "video" });

    expect(defined(stubs.media.at(-1)).type).toBe("video");
    expect(defined(stubs.media.at(-1)).photoDetails).toEqual({ image_hash: "hb", video: true });
  });

  it("does not wait on a public page, which never fetches details", async () => {
    await renderViewer({ type: "video", isPublic: true });

    expect(defined(stubs.media.at(-1)).type).toBe("video");
  });
});

describe("ContentViewer shortcuts", () => {
  /** The lightbox's commands, as the toolbar and the player subscribe to them. */
  function commandsOf(): LightboxCommands {
    const commands = stubs.commands.at(-1);
    if (!commands) throw new Error("LightboxControls was not rendered");
    return commands;
  }

  it.each([
    ["f", "favorite"],
    ["h", "hide"],
    ["p", "public"],
    ["d", "delete"],
  ] as const)("sends %s to the toolbar as %s, without a window event", async (key, command) => {
    stubs.details = {
      data: { id: "pb", image_hash: "hb", rating: 0, hidden: false, in_trashcan: false },
      isLoading: false,
    };
    await renderViewer();
    const handler = vi.fn<() => void>();
    const windowEvents = vi.spyOn(window, "dispatchEvent");
    commandsOf().on(command, handler);

    await press(key);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(windowEvents).not.toHaveBeenCalled();
    windowEvents.mockRestore();
  });

  it("sends none of the actions when the photo has no details yet", async () => {
    await renderViewer();
    const handler = vi.fn<() => void>();
    commandsOf().on("favorite", handler);

    await press("f");

    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ["ArrowLeft", { shiftKey: true }, -10],
    ["ArrowRight", { shiftKey: true }, 10],
    ["ArrowLeft", { ctrlKey: true }, -60],
    ["ArrowRight", { ctrlKey: true }, 60],
  ])("seeks the player with %s %o by %i seconds", async (key, modifiers, seconds) => {
    await renderViewer();
    const handler = vi.fn<(seconds: number) => void>();
    commandsOf().on("seek", handler);

    await press(key, document.body, modifiers);

    expect(handler).toHaveBeenCalledWith(seconds);
  });
});

describe("ContentViewer rotation", () => {
  it.each([
    ["clockwise", 90],
    ["counter-clockwise", -90],
  ])("asks for the %s turn the toolbar sends, as the user sees it (#2587)", async (_name, angle) => {
    stubs.details = { data: { image_hash: "hb" }, isLoading: false };
    await renderViewer();

    await act(async () => lastControls().onRotate(angle));

    expect(stubs.rotate).toEqual([{ image_hash: "hb", clockwiseDegrees: angle }]);
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

    await act(async () => afterTrashToggle()());

    expect(onMoveNextRequest).toHaveBeenCalledTimes(1);
    expect(onCloseRequest).not.toHaveBeenCalled();
  });

  it("steps back from the last photo", async () => {
    const { onMovePrevRequest } = await renderViewer({ nextSrc: null, nextSrcHash: null });

    await act(async () => afterTrashToggle()());

    expect(onMovePrevRequest).toHaveBeenCalledTimes(1);
  });

  it("stays put when the user has moved on before the request finished", async () => {
    const { onMoveNextRequest, onMovePrevRequest, onCloseRequest, rerender } = await renderViewer();
    // Bound when the photo was trashed, as the mutation's onSuccess is.
    const afterTrash = afterTrashToggle();

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

    await act(async () => afterTrashToggle()());

    expect(onCloseRequest).toHaveBeenCalledTimes(1);
  });
});

describe("ContentViewer 360° view", () => {
  const SPHERE = { image_hash: "hb", projection_type: "equirectangular" };

  it("offers the 360° view for a photo sphere only", async () => {
    stubs.details = { data: { image_hash: "hb" }, isLoading: false };
    await renderViewer();
    expect(lastControls().panorama?.available).toBe(false);

    stubs.details = { data: SPHERE, isLoading: false };
    await renderViewer();
    expect(lastControls().panorama?.available).toBe(true);
  });

  it("knows a sphere from the grid on a public page, which has no details", async () => {
    await renderViewer({
      isPublic: true,
      gridItem: { id: "b", image_hash: "hb", projection_type: "equirectangular" },
    });

    expect(lastControls().panorama?.available).toBe(true);
  });

  it("turns on with V: the photo shows in the viewer and a drag turns it instead of swiping", async () => {
    stubs.details = { data: SPHERE, isLoading: false };
    await renderViewer();

    await press("v");

    expect(lastControls().panorama?.active).toBe(true);
    expect(defined(stubs.media.at(-1)).panoramaActive).toBe(true);
    expect(defined(stubs.carousel.at(-1)).emblaOptions).toEqual({ watchDrag: false });
  });

  it("leaves the arrows and Z to the viewer, and Escape leaves the view before the lightbox", async () => {
    stubs.details = { data: SPHERE, isLoading: false };
    const { onMoveNextRequest, onMovePrevRequest, onCloseRequest } = await renderViewer();
    await press("v");

    await press("ArrowRight");
    await press("ArrowLeft");
    await press("z");
    expect(onMoveNextRequest).not.toHaveBeenCalled();
    expect(onMovePrevRequest).not.toHaveBeenCalled();
    expect(lastControls().isZoomed).toBe(false);

    await press("Escape");
    expect(onCloseRequest).not.toHaveBeenCalled();
    expect(lastControls().panorama?.active).toBe(false);

    await press("ArrowRight");
    expect(onMoveNextRequest).toHaveBeenCalledTimes(1);
  });

  it("shows the next photo flat", async () => {
    stubs.details = { data: SPHERE, isLoading: false };
    const { rerender } = await renderViewer();
    await press("v");

    await rerender(NEXT_ITEM);

    expect(lastControls().panorama?.active).toBe(false);
  });
});
