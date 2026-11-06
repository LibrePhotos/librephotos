/**
 * The lightbox's neighbour thumbnails (#2359): their look and hover effect come from
 * ThumbnailNavigation.module.css (`:hover`), not from mouse handlers that write `style`.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { ThumbnailNavigation } from "./ThumbnailNavigation";
import classes from "./ThumbnailNavigation.module.css";
import source from "./ThumbnailNavigation.tsx?raw";

vi.mock("../../api_client/photos/hooks/useFetchPhotoDetailsQuery", () => ({
  useFetchPhotoDetailsQuery: () => ({ data: undefined, isLoading: false }),
}));

let root: Root;
let container: HTMLDivElement;

beforeAll(async () => {
  await i18n.changeLanguage("en");
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no matchMedia, MantineProvider needs it
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

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const onMovePrevRequest = vi.fn<() => void>();
const onMoveNextRequest = vi.fn<() => void>();

function render() {
  act(() => {
    root.render(
      <MantineProvider>
        <ThumbnailNavigation
          prevSrc="prev.jpg"
          prevSrcHash="prev"
          mainSrcHash="main"
          nextSrc="next.jpg"
          nextSrcHash="next"
          onMovePrevRequest={onMovePrevRequest}
          onMoveNextRequest={onMoveNextRequest}
          isPublic
        />
      </MantineProvider>
    );
  });
}

const box = (className: string | undefined) =>
  defined(container.querySelector<HTMLElement>(`.${defined(className)}`), `.${String(className)}`);

const neighbour = (name: string) =>
  defined(container.querySelector<HTMLElement>(`[aria-label="${name}"]`), `[aria-label="${name}"]`);

describe("ThumbnailNavigation", () => {
  it("styles the neighbours from its CSS module, with no inline style to override a :hover", () => {
    render();
    const previous = neighbour("Previous");
    const next = neighbour("Next");

    expect(previous.classList).toContain(classes.neighbour);
    expect(next.classList).toContain(classes.neighbour);
    for (const element of [previous, next, box(classes.current), box(classes.strip)]) {
      expect(element.getAttribute("style")).toBeNull();
    }
    // Dimmed until pointed at, so the strip stays quiet over the photo.
    expect(getComputedStyle(previous).opacity).toBe("0.6");
  });

  it("moves to the previous and next photo on click", () => {
    render();
    act(() => neighbour("Previous").click());
    act(() => neighbour("Next").click());

    expect(onMovePrevRequest).toHaveBeenCalledOnce();
    expect(onMoveNextRequest).toHaveBeenCalledOnce();
  });

  // #2245: two unnamed images that reacted to clicks; now named buttons Tab reaches
  it("makes the neighbours named buttons", () => {
    render();
    for (const element of container.querySelectorAll<HTMLElement>(`.${defined(classes.neighbour)}`)) {
      expect(element.tagName).toBe("BUTTON");
      expect(element.getAttribute("type")).toBe("button");
      expect(["Previous", "Next"]).toContain(element.getAttribute("aria-label"));
    }
    expect(container.querySelectorAll(`.${defined(classes.neighbour)}`)).toHaveLength(2);
  });

  it("has no mouse handlers that write style", () => {
    expect(source).not.toMatch(/onMouse(Over|Out|Enter|Leave)/);
    expect(source).not.toMatch(/\.style\./);
  });
});
