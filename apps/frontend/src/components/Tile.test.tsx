/**
 * #2245: a Tile rendered an <img> without alt, so a screen reader read the file name, and a link or
 * button holding only a tile had no name. It is decorative by default and named on request.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { defined } from "../util/defined.test-utils";
import { Tile } from "./Tile";

let cleanup: (() => void) | null = null;

beforeAll(() => {
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function render(tile: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<MantineProvider>{tile}</MantineProvider>));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

describe("Tile text alternative", () => {
  it("is decorative by default", () => {
    const container = render(<Tile width={40} height={40} image_hash="abc" />);
    expect(defined(container.querySelector("img")).getAttribute("alt")).toBe("");
  });

  it("names the image when given alt", () => {
    const container = render(<Tile width={40} height={40} image_hash="abc" alt="Photo 2 of 5" />);
    expect(defined(container.querySelector("img")).getAttribute("alt")).toBe("Photo 2 of 5");
  });

  it("names a video cover with aria-label, and hides a decorative one", () => {
    const named = render(<Tile video width={40} height={40} image_hash="abc" alt="Photo 2 of 5" />);
    const video = defined(named.querySelector("video"));
    expect(video.getAttribute("aria-label")).toBe("Photo 2 of 5");
    expect(video.hasAttribute("aria-hidden")).toBe(false);
    cleanup?.();

    const decorative = defined(render(<Tile video width={40} height={40} image_hash="abc" />).querySelector("video"));
    expect(decorative.hasAttribute("aria-label")).toBe(false);
    expect(decorative.getAttribute("aria-hidden")).toBe("true");
  });
});
