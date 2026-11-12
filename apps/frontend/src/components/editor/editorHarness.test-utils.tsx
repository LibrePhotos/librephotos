/**
 * The photo editor in jsdom: no WebGL there, so a fake renderer that records what it was asked to
 * draw, a decoded source of a fixed size, the browser stubs Mantine and the canvas area need, and a
 * mount that hands both in through EditorServicesContext.
 */
import type { Photo, PhotoEdit } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import "../../i18n";
import { makePhoto } from "../lightbox/photoFixture.test-utils";
import { EditorServicesContext, type EditorServices, type PreviewRenderer } from "./editorServices";
import type { EditSource } from "./engine/editSource";
import { fitView, outputSize } from "./engine/geometry";
import type { Histogram } from "./engine/histogram";
import type { Recipe } from "./engine/recipe";
import type { RenderOptions } from "./engine/renderer";
import { PhotoEditor } from "./PhotoEditor";

const SOURCE_SIZE = { width: 400, height: 300 };

/** An srgb8 source whose image only counts its closes (jsdom has no ImageBitmap). */
function fakeSource(): EditSource & { closed: () => number } {
  let closes = 0;
  const image: ImageBitmap = { ...SOURCE_SIZE, close: () => void (closes += 1) };
  const header = { kind: "srgb8", ...SOURCE_SIZE, full_width: 4000, full_height: 3000, max: 1 } as const;
  return { kind: "srgb8", header, image, closed: () => closes };
}

type FakeRenderer = PreviewRenderer & {
  frames: { recipe: Recipe; options: RenderOptions }[];
  disposed: boolean;
  /** What histogram() answers (both pictures); null by default. */
  histogramValue: Histogram | null;
  /** Which picture each histogram() call asked for. */
  histogramCalls: ("after" | "before")[];
};

/** A renderer that draws nothing and reports the picture the real one would. */
function fakeRenderer(): FakeRenderer {
  const fake: FakeRenderer = {
    frames: [],
    disposed: false,
    histogramValue: null,
    histogramCalls: [],
    setSource: () => Promise.resolve(),
    pictureSize: (recipe, fullFrame = false) => outputSize(recipe.geometry, SOURCE_SIZE, fullFrame),
    render: (recipe, options = {}) => {
      fake.frames.push({ recipe, options });
      const fullFrame = options.showFullFrame ?? false;
      const picture = outputSize(recipe.geometry, SOURCE_SIZE, fullFrame);
      return { picture, view: options.view ?? fitView({ width: 800, height: 600 }, picture), fullFrame };
    },
    histogram: (picture = "after") => {
      fake.histogramCalls.push(picture);
      return fake.histogramValue;
    },
    isContextLost: () => false,
    dispose: () => {
      fake.disposed = true;
    },
  };
  return fake;
}

/** The stubs jsdom lacks: matchMedia, ResizeObserver (reporting an 800 x 600 stage), scrollIntoView. */
export function stubBrowser() {
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
  globalThis.ResizeObserver = class ResizeObserverStub implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}

    observe(target: Element) {
      const contentRect = DOMRectReadOnly.fromRect({ width: 800, height: 600 });
      const entry: ResizeObserverEntry = {
        target,
        contentRect,
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      };
      this.callback([entry], this);
    }

    unobserve() {}

    disconnect() {}
  };
  Element.prototype.scrollIntoView = () => {};
  // The looks' thumbnails are read from a canvas jsdom cannot draw, and the panels paint none.
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,";
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => null });
  // jsdom has no pointer capture; the drags of the curve, the wheels and the split divider use it.
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => true;
  Element.prototype.releasePointerCapture = () => {};
}

/** A few animation frames and the promises they settle. */
export async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise(resolve => {
        requestAnimationFrame(() => resolve(undefined));
      });
    });
  }
}

export const editOf = (overrides: Partial<PhotoEdit> = {}): PhotoEdit => ({
  photo_id: "p1",
  settings: { version: 1 },
  history: [],
  history_cursor: -1,
  version: 0,
  rendition: "none",
  updated_at: null,
  ...overrides,
});

export type MountedEditor = Readonly<{
  container: HTMLElement;
  renderer: FakeRenderer;
  source: ReturnType<typeof fakeSource>;
  onClose: ReturnType<typeof vi.fn<() => void>>;
  unmount: () => Promise<void>;
}>;

/** The editor on a photo of user 1, with fakes for the renderer and the source; settled after the first frame. */
/**
 * The editor on a fake renderer and source. With `sourceArrives`, the source comes in when that
 * promise settles, and the mount returns at once instead of waiting for the canvas.
 */
export async function mountEditor(photo: Partial<Photo> = {}, sourceArrives?: Promise<void>): Promise<MountedEditor> {
  const renderer = fakeRenderer();
  const source = fakeSource();
  const services: EditorServices = {
    createRenderer: () => renderer,
    loadSource: () => (sourceArrives ?? Promise.resolve()).then(() => source),
    prepareRenderer: () => {},
  };
  const onClose = vi.fn<() => void>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <EditorServicesContext.Provider value={services}>
          <PhotoEditor photo={makePhoto({ id: "p1", image_path: ["/photos/beach.jpg"], ...photo })} onClose={onClose} />
        </EditorServicesContext.Provider>
      </MantineProvider>
    );
  });
  // The source and the first frame come in over a few animation frames; slower on a busy machine.
  const waits = sourceArrives ? 0 : 50;
  for (let waited = 0; waited < waits && !document.querySelector('canvas[aria-label="Edited photo"]'); waited++) {
    await settle();
  }
  await settle();
  return {
    container,
    renderer,
    source,
    onClose,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/** The element with this accessible name (aria-label) anywhere on the page: the editor portals. */
export function byLabel(label: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("[aria-label]")].find(
    element => element.getAttribute("aria-label") === label
  );
  if (!found) throw new Error(`Nothing labelled ${label}`);
  return found;
}

/** The button with this text anywhere on the page. */
export function buttonWithText(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === text);
  if (!found) throw new Error(`No button "${text}"`);
  return found;
}

export async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  });
}

export async function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
    target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, ...init }));
  });
}
