/**
 * The 360° viewer's wiring around Photo Sphere Viewer (#483), with the library stubbed: jsdom has
 * no WebGL. What PSV itself does with the options is its own business.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { isTyping, PanoramaViewer } from "./PanoramaViewer";

type Listener = (event: { originalEvent: KeyboardEvent; preventDefault: () => void }) => void;

const stubs = vi.hoisted(() => {
  class FakeViewer {
    static instances: FakeViewer[] = [];
    readonly listeners = new Map<string, Listener>();
    readonly calls: string[] = [];
    destroyed = false;
    readonly config = { defaultYaw: 1.5, defaultPitch: undefined, defaultZoomLvl: 50 };
    constructor(readonly options: Record<string, unknown>) {
      FakeViewer.instances.push(this);
    }
    addEventListener(type: string, listener: Listener) {
      this.listeners.set(type, listener);
    }
    zoomIn() {
      this.calls.push("zoomIn");
    }
    zoomOut() {
      this.calls.push("zoomOut");
    }
    rotate(position: { yaw: number; pitch: number }) {
      this.calls.push(`rotate ${position.yaw} ${position.pitch}`);
    }
    zoom(level: number) {
      this.calls.push(`zoom ${level}`);
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { FakeViewer, reducedMotion: false };
});

vi.mock("@photo-sphere-viewer/core", () => ({ Viewer: stubs.FakeViewer, DEFAULTS: { defaultZoomLvl: 50 } }));
vi.mock("@photo-sphere-viewer/core/index.css", () => ({}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: query.includes("reduce") && stubs.reducedMotion,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
});

afterEach(() => {
  stubs.FakeViewer.instances.length = 0;
  stubs.reducedMotion = false;
});

async function renderViewer(onLoadFailed = vi.fn<() => void>()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <PanoramaViewer src="/media/photos/abc" label="Beach at dawn" onLoadFailed={onLoadFailed} />
      </MantineProvider>
    );
  });
  const viewer = () => defined(stubs.FakeViewer.instances.at(-1));
  const button = (name: string) =>
    defined(container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`), name);
  return { container, root, viewer, button, onLoadFailed };
}

/** What the viewer's key-press listener does with a key pressed on `target`: true if it was claimed. */
function keyPressOn(listener: Listener, target: EventTarget): boolean {
  const originalEvent = new KeyboardEvent("keydown", { key: "ArrowLeft" });
  Object.defineProperty(originalEvent, "target", { value: target });
  let prevented = false;
  listener({ originalEvent, preventDefault: () => (prevented = true) });
  return !prevented;
}

describe("PanoramaViewer", () => {
  it("draws the photo with its own keyboard on, its own toolbar off, and inertia", async () => {
    const { viewer, container } = await renderViewer();

    expect(viewer().options).toMatchObject({
      panorama: "/media/photos/abc",
      navbar: false,
      keyboard: "always",
      moveInertia: true,
      loadingTxt: "lightbox.panorama.loading",
    });
    const stage = defined(container.querySelector('[role="img"]'));
    expect(stage.getAttribute("aria-label")).toBe("Beach at dawn");
    expect(stage.getAttribute("aria-roledescription")).toBe("lightbox.panorama.roledescription");
  });

  it("drops the inertia under prefers-reduced-motion", async () => {
    stubs.reducedMotion = true;

    const { viewer } = await renderViewer();

    expect(viewer().options).toMatchObject({ moveInertia: false });
  });

  it("reports an image it cannot load", async () => {
    const { viewer, onLoadFailed } = await renderViewer();

    defined(viewer().listeners.get("panorama-error"))({
      originalEvent: new KeyboardEvent("keydown"),
      preventDefault: () => {},
    });

    expect(onLoadFailed).toHaveBeenCalledOnce();
  });

  it("leaves the arrow keys to a text field", async () => {
    const { viewer } = await renderViewer();
    const keyPress = defined(viewer().listeners.get("key-press"));

    expect(keyPressOn(keyPress, document.createElement("input"))).toBe(false);
    expect(keyPressOn(keyPress, document.body)).toBe(true);
  });

  it("zooms and faces forward from its bar", async () => {
    const { viewer, button } = await renderViewer();

    await act(async () => button("lightbox.panorama.zoomin").click());
    await act(async () => button("lightbox.panorama.zoomout").click());
    await act(async () => button("lightbox.panorama.faceforward").click());

    expect(viewer().calls).toEqual(["zoomIn", "zoomOut", "rotate 1.5 0", "zoom 50"]);
  });

  it("is destroyed when it closes", async () => {
    const { viewer, root } = await renderViewer();

    await act(async () => root.unmount());

    expect(viewer().destroyed).toBe(true);
  });
});

describe("isTyping", () => {
  it("is true in a field or editable text, false elsewhere", () => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    // jsdom does not compute isContentEditable from the attribute.
    Object.defineProperty(editable, "isContentEditable", { value: true });

    expect(isTyping(document.createElement("textarea"))).toBe(true);
    expect(isTyping(document.createElement("select"))).toBe(true);
    expect(isTyping(editable)).toBe(true);
    expect(isTyping(document.createElement("button"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
