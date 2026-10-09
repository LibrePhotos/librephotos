/**
 * Similar photos used to be plain hrefs: clicking one reloaded the whole app.
 * They are router links to the photo page now, also inside the lightbox, whose
 * navigation lists key photos by id while a similar photo only has its hash.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Media } from "../../api_client/photos/types";
import i18n from "../../i18n";
import { SimilarPhotosSection } from "./SimilarPhotosSection";

const navigations: string[] = [];

/** The props the section hands the router's Link. */
type LinkStubProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; params: { id: string } };

// A router Link stand-in that records client-side navigations instead of
// letting the browser follow the href.
vi.mock("@tanstack/react-router", () => ({
  Link: React.forwardRef<HTMLAnchorElement, LinkStubProps>(({ to, params, onClick, children, ...rest }, ref) => (
    <a
      ref={ref}
      {...rest}
      href={to.replace("$id", params.id)}
      onClick={event => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          event.preventDefault();
          navigations.push(to.replace("$id", params.id));
        }
      }}
    >
      {children}
    </a>
  )),
}));
vi.mock("../Tile", () => ({ Tile: () => <span /> }));

const PHOTO: React.ComponentProps<typeof SimilarPhotosSection>["photoDetail"] = {
  image_hash: "current",
  similar_photos: [
    { image_hash: "current", type: Media.IMAGE },
    { image_hash: "other", type: Media.IMAGE },
  ],
};

beforeAll(async () => {
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
  navigations.length = 0;
});

async function renderSection() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <SimilarPhotosSection photoDetail={PHOTO} />
      </MantineProvider>
    );
  });
  return container;
}

function clickLink(container: HTMLElement) {
  const links = container.querySelectorAll("a");
  expect(links).toHaveLength(1); // the current photo is left out
  expect(links[0].getAttribute("href")).toBe("/photo/other");
  act(() => {
    links[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

describe("SimilarPhotosSection", () => {
  it("routes to the photo page in the app, without a reload", async () => {
    const container = await renderSection();
    clickLink(container);
    expect(navigations).toEqual(["/photo/other"]);
  });
});
